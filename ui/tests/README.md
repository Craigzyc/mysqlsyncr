# UI regression checks

From the repository root:

```sh
npm ci
npm ci --prefix ui
npm run build --prefix ui
npm run test:ui
npm run test:browser
```

`test:ui` exercises the actual Vue component methods and reactive performance
state with controlled API responses. It covers settings cancellation and
validation, password storage, selected database scope, comparison failures,
hyphenated database names, operation locking, globally ordered apply requests,
failure/no-progress handling, and stale performance results.

`test:browser` uses installed Google Chrome in headless mode and starts a UI
server on port 3661. Every API request is intercepted with test fixtures: these
tests never connect to a database or change a template. They exercise schema
review, single and bulk apply, confirmation/cancellation, ignored differences,
error recovery, performance coverage, configuration changes, legacy routes,
and mobile layout. Browser exceptions fail the test.

Set `MYSQLSYNCR_UI_TEST_PORT` to use another port. Set `PLAYWRIGHT_CHANNEL` to
another installed Playwright browser channel if needed (for example `msedge`).
The production UI must be rebuilt after source changes because the test server
serves `ui/dist/spa`.

Reports, traces on failure, and desktop/mobile screenshots are written under
`test-results/`. These checks complement the real MySQL integration matrix;
mocked API success does not establish database restore correctness.
