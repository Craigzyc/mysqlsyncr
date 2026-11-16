import { defineConfig } from '@playwright/test';

const port = Number(process.env.MYSQLSYNCR_UI_TEST_PORT || 3661);
export default defineConfig({
    testDir: './integration',
    testMatch: 'ui.spec.js',
    timeout: 60000,
    expect: { timeout: 10000 },
    workers: 1,
    fullyParallel: false,
    outputDir: 'test-results/browser',
    reporter: [['list'], ['html', { outputFolder: 'test-results/browser-report', open: 'never' }]],
    use: {
        baseURL: `http://localhost:${port}`,
        browserName: 'chromium',
        channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: `node src/index.js ui --openUI=false --uiPort=${port}`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
});
