# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js/Puppeteer bot that logs into Facebook with a persistent browser profile, watches a list of Facebook Pages/profiles for new posts, and auto-reacts + auto-comments on the newest unprocessed post. UI strings, log messages, and comments in the code are in Vietnamese.

## Commands

```bash
npm install     # install dependencies (puppeteer only)
npm start       # run the bot (node src/auto-engage.js)
npm run check   # syntax-check all src/*.js files with `node --check` (no test suite exists)
```

There are no automated tests or a linter configured. `npm run check` is the only verification step — run it after any edit to `src/`.

On first run the browser opens non-headless; if not logged in, the bot pauses and waits for Enter in the terminal after manual login (see `waitForManualLogin` in `src/auto-engage.js`). Subsequent runs reuse the session stored in `.browser-profile/` (gitignored).

## Configuration

`config.json` (gitignored despite being tracked from the initial commit — treat edits to it as local/runtime config, not something to casually commit) drives runtime behavior:

- `pageUrls`: Facebook Page/profile URLs to monitor
- `checkIntervalMinutes`: sleep between polling cycles
- `maxPostsPerCycle`: cap on how many unprocessed posts get reacted+commented on per polling cycle per page (defaults to 5 if omitted); posts beyond the cap are left for the next cycle since they're still unprocessed in the store
- `reaction`: one of `like`, `love`, `haha`, `wow`, `sad`, `angry`
- `comments`: pool of comment strings, chosen randomly per post
- `delayBetweenActions.{minSeconds,maxSeconds}`: randomized delay range used throughout to mimic human timing

`data/processed-posts.json` (gitignored) is the dedup store keyed by extracted post ID, managed by `src/store.js`.

## Architecture

**`src/auto-engage.js` is the actual entry point and contains the live, self-contained pipeline** — browser launch, login check/wait, and per-page processing (`processNewPosts`) are all implemented inline in this one file via `page.evaluate()` DOM scraping, rather than delegating to `monitor.js`/`actions.js`.

**`src/monitor.js` and `src/actions.js` are a separate, more modular implementation that is NOT wired into `auto-engage.js`.** `actions.js` only imports `dismissPopups` from `monitor.js`; nothing in `src/` imports `actions.js` or `monitor.js`'s `fetchNewPosts`. Treat these as a parallel/legacy multi-post-scanning approach (finds top 5 posts, filters by page ownership) rather than dead code to delete without checking with the user — but be aware that changes there will NOT affect actual bot behavior unless `auto-engage.js` is also updated to call them. When fixing a real runtime bug in "finding the like button" or "posting a comment," the logic to change is almost always in `auto-engage.js`'s `processNewPosts`, not in `actions.js`.

Because of this split, when making a fix, first check whether the same DOM-scraping logic (reaction button detection, comment box detection, post URL extraction) is duplicated between `auto-engage.js` and `actions.js`/`monitor.js`, and decide whether the user wants both updated or just the live path.

### Key mechanics inside `processNewPosts` / `interactWithPost` (`auto-engage.js`)

- Facebook virtualizes the feed DOM: scrolling down purges older elements, scrolling back up can purge the newest. The scroll sequence (down twice, back to top, small down scroll, then several more down scrolls to load additional posts) exists specifically to force multiple recent posts into the DOM without losing the newest one — don't "simplify" this without preserving that behavior.
- `processNewPosts` scans **all** `[aria-posinset]` feed units currently in the DOM (not just the newest), tags each post-level Like button with a unique `data-bot-target` marker, and returns them sorted top-to-bottom. The outermost post-level Like button is disambiguated from comment-like buttons using bounding-box height and DOM position (must not be inside `<li>`/`<ul>`), and from shared/nested posts by taking the last matching button in DOM order.
- For each candidate, a post is skipped if the page already shows it as reacted (`aria-label` containing "Gỡ"/"Remove") or if `store.isProcessed(postId)` is already true; otherwise `interactWithPost` reacts and comments on it, and the loop continues to the next candidate — so one cycle can react to/comment on several new posts, not just one. There's a `randomDelay` (from `config.delayBetweenActions`) between each post's interaction to space out actions.
- `interactWithPost` opens the reaction picker via `hover()`, then matches localized `aria-label`s (Vietnamese and English) via a `reactionMap`; falls back to a plain Like click if the picker doesn't appear.
- Post identity for dedup comes from `utils.extractPostId`, which handles multiple Facebook URL shapes (`story_fbid`, `fbid`, `/posts/`, `/videos/`, `/reel/`, `pfbid...`, etc.) — extend this list rather than adding ad hoc ID logic elsewhere.
- The polling loop (`main`) runs one cycle immediately, then on a `setInterval` of `checkIntervalMinutes`; `SIGINT`/`SIGTERM` close the browser gracefully. How many posts get caught per cycle is bounded by how many load into the DOM during the scroll sequence, not by a hardcoded count.

### Module responsibilities

- `src/utils.js`: logging (`log`, Vietnamese-locale timestamps, colored level prefixes), `randomDelay`/`randomChoice` for human-like pacing, `extractPostId`/`cleanPostUrl` for URL normalization.
- `src/store.js`: flat JSON-backed dedup store (`data/processed-posts.json`) keyed by post ID; read-modify-write on every call (no in-memory caching), fine at this scale.
- `src/monitor.js`: (unused by the live path) `fetchNewPosts` scans the top 5 links in `[role="main"]`, filters out avatar/cover/sidebar links and posts belonging to other pages (via page ID/alias matching against the target `pageUrl`), returns the first unprocessed post.
- `src/actions.js`: (unused by the live path) `reactToPost`/`commentOnPost`, a selector-based (non-`page.evaluate`) alternative to the reaction/comment logic in `auto-engage.js`.

## Working with Facebook DOM selectors

Selectors throughout the codebase key off localized `aria-label` values (Vietnamese: "Thích", "Yêu thích", "Viết bình luận"; English: "Like", "Love", "Leave a comment") since Facebook's UI language depends on the logged-in account. When adding new selectors or reaction types, add both language variants, matching the existing `reactionMap` pattern in both `auto-engage.js` and `actions.js`.

Facebook's markup changes frequently and is unversioned/unofficial — expect selector-based logic to be brittle and to need periodic updates when the bot stops finding buttons.
