const fs = require("fs");
const path = require("path");
const readline = require("readline");
const puppeteer = require("puppeteer");

const { log, randomDelay, randomChoice, extractPostId } = require("./utils");
const store = require("./store");

const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");
const PROFILE_DIR = path.resolve(__dirname, "..", ".browser-profile");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log("Không tìm thấy config.json! Hãy tạo file config trước.", "error");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function printBanner(config) {
  const conf = config || {};
  const pageUrls = conf.pageUrls || [];
  const reaction = conf.reaction || "love";
  const interval = conf.checkIntervalMinutes || 0;
  const processedCount = store.getProcessedCount ? store.getProcessedCount() : 0;

  console.log("\n--- FB AUTO ENGAGE BOT ---");
  console.log(`- Pages: ${pageUrls.length}`);
  console.log(`- Reaction: ${reaction}`);
  console.log(`- Interval: ${interval} minutes`);
  console.log(`- Processed: ${processedCount}`);
  console.log("--------------------------\n");
}

async function checkLogin(page) {
  log("Đang kiểm tra đăng nhập...", "info");
  await page.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await randomDelay(3, 5);

  const isLoginPage = await page.evaluate(() => {
    return (
      !!document.querySelector("#email") ||
      !!document.querySelector('input[name="email"]') ||
      !!document.querySelector('[data-testid="royal_email"]')
    );
  });

  return !isLoginPage;
}

async function waitForManualLogin(page) {
  log("Chưa đăng nhập! Hãy đăng nhập thủ công trong trình duyệt.", "warn");
  log("Nhấn Enter sau khi đã đăng nhập xong...", "warn");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise((resolve) => {
    rl.question("> Nhấn Enter khi đã đăng nhập: ", () => {
      rl.close();
      resolve();
    });
  });

  // Verify login after user confirms
  const loggedIn = await checkLogin(page);
  if (!loggedIn) {
    log("Vẫn chưa đăng nhập được. Vui lòng thử lại.", "error");
    process.exit(1);
  }

  log("Đăng nhập thành công!", "success");
}

// Thả cảm xúc + bình luận cho MỘT bài viết đã xác định được nút Like.
// Trả về { reacted, commented } để bên gọi lưu vào store.
async function interactWithPost(page, targetLikeButton, config) {
  const { reaction, comments } = config;

  // 1. Scroll it fully into view just in case
  await targetLikeButton.hover();
  await randomDelay(2, 3);

  // 2. Click Reaction
  const reactionMap = {
    love: ["Yêu thích", "Love"],
    like: ["Thích", "Like"],
    haha: ["Haha"],
    wow: ["Wow"],
    sad: ["Buồn", "Sad"],
    angry: ["Phẫn nộ", "Angry"]
  };

  const labelsToFind = reactionMap[reaction.toLowerCase()] || reactionMap.like;
  let reactionClicked = false;

  // Look for the reaction popup options.
  // Có thể tồn tại nhiều phần tử trùng aria-label (bảng cảm xúc của bài trước
  // chưa bị gỡ khỏi DOM); bảng vừa mở luôn nằm cuối DOM nên duyệt ngược
  // và chỉ lấy nút đang hiển thị.
  for (const label of labelsToFind) {
      const rxBtns = await page.$$(`div[aria-label="${label}"]`);
      for (let i = rxBtns.length - 1; i >= 0; i--) {
          const rxBox = await rxBtns[i].boundingBox();
          if (rxBox && rxBox.width > 0) {
              await rxBtns[i].click();
              reactionClicked = true;
              break;
          }
      }
      if (reactionClicked) break;
  }

  if (!reactionClicked) {
      log("Không mở được bảng cảm xúc, click Like thay thế.", "warn");
      await targetLikeButton.click();
  } else {
      log(`Đã thả cảm xúc "${reaction}" thành công!`, "success");
  }

  await randomDelay(2, 3);

  // 3. Tìm nút bình luận (chỉ 2 cấp trên từ nút Like)
  log("Đang tìm nút bình luận...", "info");
  const commentClicked = await page.evaluate((likeBtn) => {
      let wrapper = likeBtn;
      // Chỉ cần lên 2-3 cấp là đến container chứa cả nút Like và nút Bình luận
      for(let i=0; i<3; i++) {
          if (wrapper.parentElement) wrapper = wrapper.parentElement;
      }
      const btn = wrapper.querySelector(
          'div[aria-label="Viết bình luận"][role="button"], ' +
          'div[aria-label="Leave a comment"][role="button"], ' +
          'div[aria-label="Bình luận"][role="button"], ' +
          'div[aria-label="Comment"][role="button"]'
      );
      if (btn) { btn.click(); return true; }
      return false;
  }, targetLikeButton);

  let commented = false;

  if (commentClicked) {
      // Chờ Facebook mở và auto-focus ô bình luận. Composer có thể mở inline
      // hoặc dạng hộp thoại (popup) và tốc độ tùy mạng, nên chờ kiểu poll
      // thay vì chỉ kiểm tra một lần.
      let isActiveTextbox = false;
      for (let attempt = 0; attempt < 5; attempt++) {
          await randomDelay(1, 1.5);
          isActiveTextbox = await page.evaluate(() => {
              const el = document.activeElement;
              return !!el && el.getAttribute('role') === 'textbox';
          });
          if (isActiveTextbox) break;
      }

      log("Đang nhập bình luận...", "info");
      const commentText = randomChoice(comments);

      if (isActiveTextbox) {
          // Lấy chính xác ô textbox đang được focus và bấm thêm 1 lần cho chắc chắn
          const activeElementHandle = await page.evaluateHandle(() => document.activeElement);
          await activeElementHandle.click();
          await randomDelay(1, 2);
          await page.keyboard.type(commentText, { delay: 60 });
          await randomDelay(1, 2);
          await page.keyboard.press("Enter");
          log(`Đã bình luận thành công: "${commentText}"`, "success");
          commented = true;
      } else {
          // Fallback: Tìm textbox gần nút Like nhất
          log("Không thấy ô bình luận auto-focus, tìm xung quanh bài viết...", "warn");
          const fallbackBox = await page.evaluateHandle((likeBtn) => {
              // Ưu tiên hộp thoại bình luận đang mở (Facebook thường mở dạng popup
              // ở cấp document nên không nằm trong cây DOM của bài viết)
              const dialogs = document.querySelectorAll('div[role="dialog"]');
              for (let i = dialogs.length - 1; i >= 0; i--) {
                  const tb = dialogs[i].querySelector('div[role="textbox"]');
                  if (tb) return tb;
              }
              let wrapper = likeBtn;
              for(let i=0; i<8; i++) {
                  if(wrapper.parentElement) wrapper = wrapper.parentElement;
              }
              return wrapper.querySelector('div[role="textbox"]');
          }, targetLikeButton);

          const hasFallback = await page.evaluate(el => el !== null, fallbackBox);
          if (hasFallback) {
              await fallbackBox.click();
              await randomDelay(1, 2);
              await page.keyboard.type(commentText, { delay: 60 });
              await randomDelay(1, 2);
              await page.keyboard.press("Enter");
              log(`Đã bình luận thành công (fallback): "${commentText}"`, "success");
              commented = true;
          } else {
              log("Hoàn toàn không tìm thấy ô bình luận nào!", "error");
          }
      }
  } else {
      log("Không tìm thấy nút Bình luận bên cạnh nút Like.", "error");
  }

  // Đóng khung bình luận còn mở và đưa chuột ra góc màn hình để bảng cảm xúc /
  // ô bình luận của bài này không ảnh hưởng thao tác với bài tiếp theo
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 10);
  await randomDelay(2, 3);

  return { reacted: true, commented };
}

async function processNewPosts(page, pageUrl, config) {
  log("Đang mở trang: " + pageUrl, "step");
  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(4, 6);

  // Cuộn xuống một chút để kích hoạt tải feed, rồi cuộn ngược lên đầu trang
  // Lý do: Facebook dùng virtual DOM - khi cuộn xuống quá xa, bài viết mới nhất
  // ở trên cùng sẽ bị XÓA khỏi DOM để tiết kiệm bộ nhớ.
  log("Đang tải feed...", "info");
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await randomDelay(1.5, 2);
  }
  // Cuộn về đầu trang để bài mới nhất hiện trong DOM
  await page.evaluate(() => window.scrollTo(0, 0));
  await randomDelay(2, 3);
  // Cuộn xuống vừa đủ để qua phần header/ảnh bìa và thấy bài đầu tiên
  await page.evaluate(() => window.scrollBy(0, 700));
  await randomDelay(1, 2);

  // Quét tất cả bài viết đang có trong DOM và xác định nút Like của từng bài.
  // Phải quét LẠI sau mỗi lần tương tác vì Facebook re-render feed sau khi
  // thả cảm xúc/bình luận, làm marker và ElementHandle cũ không còn dùng được.
  const scanCandidates = () => page.evaluate(() => {
      // Gỡ marker của lần quét trước để không nhặt nhầm nút cũ
      document.querySelectorAll('[data-bot-target]').forEach((el) => el.removeAttribute('data-bot-target'));

      const feedUnits = document.querySelectorAll('[aria-posinset]');
      const results = [];
      let idx = 0;

      for (const unit of feedUnits) {
          // Lên vài cấp để bao trọn cả bài viết (phòng trường hợp action bar nằm ngoài thẻ aria-posinset một chút)
          let wrapper = unit;
          for(let i=0; i<3; i++) {
             if(wrapper.parentElement) wrapper = wrapper.parentElement;
          }

          const likeBtns = wrapper.querySelectorAll(
              'div[aria-label="Thích"][role="button"], ' +
              'div[aria-label="Like"][role="button"], ' +
              'div[aria-label*="Gỡ Thích"], ' +
              'div[aria-label*="Remove Like"], ' +
              'div[aria-label*="Gỡ Yêu thích"], ' +
              'div[aria-label*="Remove Love"]'
          );

          if (likeBtns.length === 0) continue;

          // Lọc bỏ các nút Like CỦA BÌNH LUẬN (Comment Like buttons).
          // Nút Like của bài viết thường to (height ~ 32px), không nằm trong thẻ <ul> hay <li>.
          // Nút Like của bình luận là dạng text nhỏ (height ~ 12px-16px) và thường nằm trong <ul>/<li>.
          const validPostLikeBtns = Array.from(likeBtns).filter(btn => {
              const r = btn.getBoundingClientRect();
              if (r.height < 24) return false; // Loại bỏ nút quá nhỏ (nút của comment)

              // Kiểm tra xem có nằm trong danh sách bình luận không
              let cur = btn;
              for(let i=0; i<8; i++) {
                 if(!cur) break;
                 const tag = cur.tagName.toLowerCase();
                 if(tag === 'li' || tag === 'ul') return false;
                 cur = cur.parentElement;
              }
              return true;
          });

          if (validPostLikeBtns.length === 0) continue;

          // Lấy nút Like NGOÀI CÙNG của BÀI VIẾT (thuộc về Fanpage hiện tại chứ không phải bài bị share bên trong).
          // Nút ngoài cùng luôn nằm ở cuối cùng trong DOM của bài viết đó.
          const targetBtn = validPostLikeBtns[validPostLikeBtns.length - 1];

          const rect = targetBtn.getBoundingClientRect();
          if (rect.width === 0) continue;

          const absoluteY = rect.top + window.scrollY;

          // Bỏ qua nút Like nằm trong header/avatar
          if (absoluteY < 600) continue;

          const label = targetBtn.getAttribute('aria-label') || "";
          const alreadyReacted = label.includes('Gỡ') || label.includes('Remove');

          // Trích xuất URL bài viết để lưu lịch sử / kiểm tra trùng lặp
          let container = targetBtn;
          for (let i=0; i<10; i++) {
              if (container.parentElement) container = container.parentElement;
          }
          let postUrl = null;
          const links = container.querySelectorAll('a[href]');
          for (const link of links) {
              const href = link.getAttribute('href');
              if (href && (href.includes('/posts/') || href.includes('/photo/') || href.includes('fbid=') || href.includes('/videos/') || href.includes('/reel/'))) {
                  if (!href.includes('set=pb.') && !href.includes('set=a.') && !href.includes('makeprofile')) {
                      postUrl = href;
                      break;
                  }
              }
          }

          // Đánh dấu nút này để Puppeteer lấy ElementHandle ở bước sau
          const marker = 'bot-target-' + idx;
          targetBtn.setAttribute('data-bot-target', marker);
          results.push({ marker, y: absoluteY, alreadyReacted, postUrl });
          idx++;
      }

      // Sắp xếp từ trên xuống dưới (bài mới nhất trước)
      results.sort((a, b) => a.y - b.y);
      return results;
  });

  const maxPostsPerCycle = config.maxPostsPerCycle || 5;
  const MAX_SCROLL_STEPS = 10;
  let interactedCount = 0;
  let checkedCount = 0;
  // Các bài đã xét trong chu kỳ này (kể cả bị bỏ qua) để không xét lại
  const seenThisCycle = new Set();

  // Càn quét từ TRÊN XUỐNG: xử lý hết các bài đang render ở vị trí cuộn hiện tại
  // rồi mới cuộn xuống tiếp. Lý do: Facebook virtualize feed - nếu cuộn xuống hết
  // rồi mới quét một lần thì các bài ở đầu trang (nhất là bài share ảnh/video nặng)
  // đã bị XÓA khỏi DOM và bot sẽ không bao giờ thấy chúng.
  // "N bài gần nhất" = N bài đầu tiên gặp được tính từ đầu trang xuống.
  for (let step = 0; step < MAX_SCROLL_STEPS && checkedCount < maxPostsPerCycle; step++) {
      let domChanged = true;
      while (domChanged && checkedCount < maxPostsPerCycle) {
          domChanged = false;
          const candidates = await scanCandidates();

          for (const candidate of candidates) {
              // Bài không lấy được URL thì nhận diện tạm theo vùng vị trí trên trang
              const postId = candidate.postUrl
                ? extractPostId(candidate.postUrl)
                : `y-${Math.round(candidate.y / 120)}`;
              if (seenThisCycle.has(postId)) continue;

              seenThisCycle.add(postId);
              checkedCount++;

              if (candidate.alreadyReacted) {
                  log("Bỏ qua bài đã tương tác (trạng thái trên trang).", "info");
              } else if (candidate.postUrl && store.isProcessed(postId)) {
                  log("Bỏ qua bài đã xử lý trước đó (theo lịch sử lưu trữ).", "info");
              } else {
                  const targetLikeButton = await page.$(`[data-bot-target="${candidate.marker}"]`);
                  if (!targetLikeButton) {
                      log("Nút Like không còn trong DOM (feed đã thay đổi), quét lại...", "warn");
                  } else {
                      log("Phát hiện bài viết mới chưa tương tác. Tiến hành thả cảm xúc.", "step");
                      try {
                          const { reacted, commented } = await interactWithPost(page, targetLikeButton, config);

                          store.markProcessed(postId, {
                            url: candidate.postUrl || "inline-interaction",
                            postType: "status",
                            reacted,
                            commented,
                            reaction: config.reaction
                          });

                          interactedCount++;
                          log("Đã hoàn tất toàn bộ thao tác cho bài viết này!", "success");
                      } catch (err) {
                          log(`Lỗi khi tương tác với bài viết: ${err.message}. Bỏ qua bài này, sẽ thử lại ở chu kỳ sau.`, "error");
                      }

                      // Chờ ngẫu nhiên trước khi chuyển sang bài viết tiếp theo
                      const delayCfg = config.delayBetweenActions || {};
                      await randomDelay(delayCfg.minSeconds || 5, delayCfg.maxSeconds || 10);
                  }
                  // DOM đã thay đổi sau tương tác (hoặc marker đã mất) - quét lại
                  domChanged = true;
              }

              if (domChanged || checkedCount >= maxPostsPerCycle) break;
          }
      }

      if (checkedCount >= maxPostsPerCycle) break;

      // Cuộn xuống để Facebook render thêm bài cũ hơn
      await page.evaluate(() => window.scrollBy(0, 850));
      await randomDelay(1.5, 2.5);
  }

  if (checkedCount === 0) {
      log("Không tìm thấy bài viết nào trên trang. Có thể do mạng chậm, hãy thử lại.", "warn");
  } else if (interactedCount === 0) {
      log(`Đã kiểm tra ${checkedCount} bài viết gần nhất - không có bài mới nào cần tương tác.`, "info");
  } else {
      log(`Đã kiểm tra ${checkedCount} bài viết gần nhất, tương tác ${interactedCount} bài mới.`, "success");
  }
}

async function main() {
  const config = loadConfig();
  printBanner(config);

  log("Đang khởi động trình duyệt...", "step");
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    userDataDir: PROFILE_DIR,
    args: [
      "--start-maximized", 
      "--no-sandbox", 
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu"
    ]
  });

  const [page] = await browser.pages();

  // Check login status
  const isLoggedIn = await checkLogin(page);
  if (!isLoggedIn) {
    await waitForManualLogin(page);
  } else {
    log("Đã đăng nhập sẵn!", "success");
  }

  // Main loop
  log("Bot đã sẵn sàng! Bắt đầu theo dõi...", "success");

  let cycleCount = 0;
  const runCycle = async () => {
    cycleCount++;
    log(`\n${"═".repeat(50)}`, "info");
    log(`Chu kỳ #${cycleCount} - Đang kiểm tra các trang...`, "step");
    log(`${"═".repeat(50)}`, "info");

    try {
      const urls = Array.isArray(config.pageUrls) ? config.pageUrls : [config.pageUrl].filter(Boolean);
      for (const url of urls) {
        log(`\n>>> Xử lý trang: ${url}`, "info");
        await processNewPosts(page, url, config);
        await randomDelay(3, 5); // Chờ một chút trước khi sang trang tiếp theo
      }
    } catch (err) {
      log(`Lỗi trong chu kỳ kiểm tra: ${err.message}`, "error");
    }
  };

  // Run first cycle immediately
  await runCycle();

  // Schedule subsequent cycles
  const intervalMs = config.checkIntervalMinutes * 60 * 1000;
  log(`\nChờ ${config.checkIntervalMinutes} phút cho chu kỳ tiếp theo...`, "info");

  const interval = setInterval(async () => {
    await runCycle();
    log(`\nChờ ${config.checkIntervalMinutes} phút cho chu kỳ tiếp theo...`, "info");
  }, intervalMs);

  // Handle graceful shutdown
  const shutdown = async () => {
    log("\nĐang tắt bot...", "warn");
    clearInterval(interval);
    await browser.close();
    log("Bot đã dừng. Tạm biệt!", "info");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process alive
  await new Promise(() => {});
}

main().catch((err) => {
  log(`Lỗi nghiêm trọng: ${err.message}`, "error");
  console.error(err);
  process.exitCode = 1;
});
