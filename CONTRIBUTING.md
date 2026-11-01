# Contributing to Folio

Bug reports, small fixes, and improvements to document rendering are welcome.

1. Fork the repository and create a branch.
2. Install dependencies with `npm ci` (Node.js 22 or newer).
3. Run `npm run bundle` and `npm test`. Tests use Google Chrome by default; set `FOLIO_TEST_BROWSER=chromium` after `npx playwright install chromium` to use Playwright's browser instead.
4. On a Mac with Xcode Command Line Tools, run `npm run build` and open the resulting Folio.app.
5. Open a pull request explaining the user-visible change and how you checked it.

Keep document files read-only, keep Mermaid rendering offline, and preserve the isolation between HTML content and the native bridge. Avoid adding network dependencies to the reading path.

Use synthetic or public documents in issues and screenshots. Do not post private documents, credentials, or absolute personal file paths.

The renderer lives in `web/`, the native host in `Sources/Folio.swift`, and build/media tooling in `scripts/`.
