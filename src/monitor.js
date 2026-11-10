const { log, randomDelay, extractPostId, cleanPostUrl } = require("./utils");
const store = require("./store");

const POST_URL_PATTERNS = [
  /\/posts\//,
  /\/permalink\.php/,
  /story_fbid/,
  /fbid=/,
  /\/videos\//,
  /\/photos?\//,
  /\/photo\.php/,
  /\/reel\//,
  /\/watch\//,
  /pfbid/,
  /\/share\//,
  /\/p\//
];

// Non-post links to exclude
const EXCLUDE_URL_PATTERNS = [
  /\/friends\/?$/,
  /\/about\/?$/,
  /\/photos_by\/?$/,
  /\/photos_of\/?$/,
  /\/videos_by\/?$/,
  /\/events\/?$/,
  /\/reviews\/?$/,
  /\/likes\/?$/,
  /\/followers\/?$/,
  /\/following\/?$/,
  /\/groups\/?$/,
  /\/marketplace/,
  /\/gaming/,
  /\/settings/,
  /\/notifications/,
  /\/messages/,
  /\/bookmarks/,
  /hashtag\//,
  /\/login/,
  /\/recover/,
  /\/help/,
  /^https?:\/\/[^/]+\/?$/
];

// Regex patterns to identify timestamp text (Vietnamese & English)
const TIMESTAMP_REGEX = [
  /^\d+\s*(phút|giây|giờ|ngày|tuần|tháng|năm)/i,
  /^\d+\s*(m|h|d|w|s|min|mins|hr|hrs|sec|secs)/i,
  /^\d+\s*(minutes?|hours?|days?|weeks?|months?|seconds?|years?)/i,
  /^(vừa xong|just now|mới đây|hôm qua|yesterday|now)/i
];

/**
 * Fetch the LATEST post from the fanpage.
 * Returns an array with 0 or 1 post.
 * - If the latest post has already been processed, returns [].
 * - Otherwise returns [{ postId, url, postType }].
 */
async function fetchNewPosts(page, pageUrl) {
  log("Dang mo page: " + pageUrl, "step");
  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(4, 6);

  // Dismiss any popups
  await dismissPopups(page);

  // Scroll to trigger lazy loading of the actual feed
  log("Dang scroll de load feed bai viet...", "info");
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await randomDelay(1, 2);
  }

  // Extract target page ID and Alias to filter out shared posts from other pages
  let targetId = null;
  let targetAlias = null;
  try {
      const u = new URL(pageUrl);
      targetId = u.searchParams.get("id");
      const pathParts = u.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
          const firstPart = pathParts[0];
          if (firstPart !== "profile.php" && firstPart !== "pages") {
              targetAlias = firstPart;
          }
      }
  } catch (err) {}

  // Extract the top 5 posts from the page
  const latestPosts = await page.evaluate(
    (timestampPatterns, postPatterns, excludePatterns, targetId, targetAlias) => {
      const isTimestamp = (text) => {
        if (!text || text.length === 0 || text.length > 30) return false;
        return timestampPatterns.some((p) => new RegExp(p, "i").test(text.trim()));
      };

      const isPostLink = (url) => {
        return postPatterns.some((p) => new RegExp(p).test(url));
      };

      const isExcluded = (url) => {
        return excludePatterns.some((p) => new RegExp(p).test(url));
      };

      const isAvatarOrCover = (link, url) => {
        // Exclude sidebar photo widgets
        if (url.includes("set=pb.")) return true;

        const rect = link.getBoundingClientRect();
        const absoluteY = rect.top + window.scrollY;
        
        // The avatar and cover photo are always at the top of the page (y < 500)
        // Feed posts usually start much lower (y > 600+)
        if (absoluteY < 500) {
            return true;
        }

        return false;
      };

      // FIX: Pages using profile.php?id=... have targetAlias=null.
      // Previously ALL posts with an alias-based URL were wrongly rejected.
      // Now we only reject posts that:
      //   (a) have an ?id= param that doesn't match OUR page id, OR
      //   (b) have an alias-based path that explicitly doesn't match OUR alias.
      // Generic path segments (pfbid, posts, photos, videos, reel, share, etc.)
      // are not alias-based and must NOT trigger a rejection.
      const isBelongingToTargetPage = (url) => {
          if (!url) return false;
          try {
              const u = new URL(url);
              
              // 1. Check ID param — if the post URL carries ?id= that differs from ours, reject
              const idParam = u.searchParams.get("id");
              if (idParam && targetId && idParam !== targetId) return false;

              // 2. Check path alias
              const pathParts = u.pathname.split('/').filter(Boolean);
              if (pathParts.length > 0) {
                  const firstPart = pathParts[0].toLowerCase();
                  
                  // Generic Facebook paths that do NOT encode the page identity
                  const genericPaths = [
                    "photo", "photos", "video", "videos", "watch", "reel",
                    "share", "permalink.php", "story.php", "profile.php", "p",
                    // pfbid & posts appear as first segment in many modern post URLs
                    "posts", "pfbid"
                  ];
                  
                  if (!genericPaths.includes(firstPart)) {
                      // The first path segment is a username/alias.
                      if (targetAlias && firstPart !== targetAlias.toLowerCase()) {
                          return false; // Belongs to a DIFFERENT page!
                      }
                      
                      // Our page has no alias (profile.php?id=...) but this URL
                      // has a username alias we don't recognise.
                      // Only reject if we can verify via targetId — otherwise accept
                      // (better to interact than miss posts).
                      if (!targetAlias && targetId) {
                          return false;
                      }
                  }
              }
              
              return true;
          } catch(e) {
              return true;
          }
      };

      // Instead of relying on [role="article"] which is missing in some FB layouts,
      // we scan ALL links inside the main feed area.
      const mainContainer = document.querySelector('[role="main"]') || document.body;
      const allLinks = mainContainer.querySelectorAll("a[href]");
      
      const foundPosts = [];
      const seenUrls = new Set();

      for (const link of allLinks) {
        let postUrl = null;
        let postType = "status";

        const text = (link.textContent || "").trim();
        const ariaLabel = (link.getAttribute("aria-label") || "").trim();
        const href = link.getAttribute("href") || "";
        
        if (!href || href === "#") continue;
        
        const fullUrl = href.startsWith("http") ? href : window.location.origin + href;
        if (isExcluded(fullUrl)) continue;

        // Skip avatar, cover photo, and sidebar links
        if (isAvatarOrCover(link, fullUrl)) continue;

        // Is it a timestamp link or a known post URL?
        if (isTimestamp(text) || isTimestamp(ariaLabel)) {
           postUrl = fullUrl;
        } else if (isPostLink(fullUrl)) {
           postUrl = fullUrl;
        }

        if (postUrl) {
          // Verify that this post actually belongs to the target page, not a shared post from another page
          if (!isBelongingToTargetPage(postUrl)) continue;

          // Use basic URL without tracking for set uniqueness
          const cleanUrl = fullUrl.split('?__cft__')[0].split('&__cft__')[0];
          
          if (!seenUrls.has(cleanUrl)) {
             seenUrls.add(cleanUrl);
             
             if (/\/videos\/|\/watch\//.test(postUrl)) postType = "video";
             else if (/\/photos?\//.test(postUrl) || postUrl.includes('fbid=')) postType = "photo";
             else if (/\/reel\//.test(postUrl)) postType = "reel";
             else if (/\/share\//.test(postUrl)) postType = "share";
             
             foundPosts.push({ url: postUrl, postType });
             
             // We only need the top 5 to check for unprocessed ones
             if (foundPosts.length >= 5) break;
          }
        }
      }

      return foundPosts;
    },
    TIMESTAMP_REGEX.map((r) => r.source),
    POST_URL_PATTERNS.map((r) => r.source),
    EXCLUDE_URL_PATTERNS.map((r) => r.source),
    targetId,
    targetAlias
  );

  // No post found at all
  if (!latestPosts || latestPosts.length === 0) {
    log("Khong tim thay bai viet nao tren page.", "warn");
    return [];
  }

  // Iterate over the found posts to find the FIRST UNPROCESSED one
  for (const post of latestPosts) {
    const url = cleanPostUrl(post.url);
    const postId = extractPostId(url);

    if (!store.isProcessed(postId)) {
      log("Bai viet CHUA xu ly! Se tuong tac [" + post.postType + "]: " + url.substring(0, 80), "success");
      return [{ postId, url, postType: post.postType }];
    } else {
      log("Bo qua bai da xu ly: " + url.substring(0, 80), "info");
    }
  }

  log("Tat ca bai viet hien hanh tren page (top 5) deu da duoc xu ly.", "info");
  return [];
}

async function dismissPopups(page) {
  try {
    const dismissSelectors = [
      '[aria-label="Close"]',
      '[aria-label="Đóng"]',
      '[data-testid="cookie-policy-manage-dialog-accept-button"]',
      'button[title="Close"]',
      'div[aria-label="Decline optional cookies"]'
    ];

    for (const sel of dismissSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        const isVisible = await btn.boundingBox();
        if (isVisible) {
          await btn.click();
          await randomDelay(0.5, 1);
        }
      }
    }
  } catch {
    // Ignore popup dismissal errors
  }
}

module.exports = { fetchNewPosts, dismissPopups };
