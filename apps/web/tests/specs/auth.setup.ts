import { test as setup, expect } from '@playwright/test';

const EMAIL = process.env.ZENTRA_TEST_EMAIL;
const PASSWORD = process.env.ZENTRA_TEST_PASSWORD;

setup('authenticate', async ({ page }) => {
  if (!EMAIL || !PASSWORD) {
    throw new Error('Set ZENTRA_TEST_EMAIL and ZENTRA_TEST_PASSWORD env vars');
  }

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Wait for redirect away from /login (goes to /workspaces per login page)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: 'auth.json' });
});
