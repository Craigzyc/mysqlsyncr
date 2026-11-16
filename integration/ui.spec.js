import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import browserSmoke from '../ui/tests/browser-smoke.js';

test('workspace reviews and applies changes, isolates settings, handles failures and adapts to mobile', async ({ page, baseURL }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const artifactDir = testInfo.outputPath('screenshots');
    await fs.mkdir(artifactDir, { recursive: true });
    const result = await browserSmoke(page, { origin: baseURL, artifactDir });
    expect(result.passed).toBe(8);
    expect(errors).toEqual([]);
    await testInfo.attach('scenarios', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('legacy routes open the functional workspace', async ({ page, baseURL }) => {
    await page.route('**/api/**', route => route.abort());
    for (const route of ['dump', 'compare', 'apply']) {
        await page.goto(`${baseURL}/#/${route}`);
        await expect(page.getByRole('button', { name: 'Configure connection', exact: true })).toBeVisible();
        await expect(page).toHaveURL(`${baseURL}/#/`);
    }
});
