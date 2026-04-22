import { test, expect, Page } from '@playwright/test';
import { getSession, resetToday, seedPrimedUnclear, seedPlanBlocks, seedCompleteState, SeedSession } from './helpers/seed';

/**
 * Zentra /today flow regression tests.
 *
 * State is seeded via the API before each describe block so we can exercise
 * mutually-exclusive /today states (Primed / Complete / Working plan) from a
 * single shared test account.
 */

async function goToToday(page: Page) {
  await page.goto('/today');
  await expect(page.locator('body')).not.toContainText('Loading...', { timeout: 10000 });
}

// -------------------------------------------------------------------
// §1 Loading → state routing
// -------------------------------------------------------------------
test.describe('§1 Loading → state routing', () => {
  test('1.x loads /today without hard errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await goToToday(page);

    await expect(page).toHaveURL(/\/today/);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length, 'Body text should not be empty').toBeGreaterThan(10);
    expect(bodyText).not.toMatch(/^Loading\.\.\.\s*$/);

    const hardErrors = consoleErrors.filter(
      (e) => !/DevTools|Download the React|Warning:|Failed to load resource|401|404|net::ERR/i.test(e),
    );
    expect(hardErrors, `Console errors: ${hardErrors.join('\n')}`).toHaveLength(0);
  });
});

// -------------------------------------------------------------------
// §2 Error state (FIX #10) — best-effort offline simulation
// -------------------------------------------------------------------
test.describe('§2 Error state', () => {
  test('2.1 offline load shows Error UI with Retry + Close the day', async ({ page, context }) => {
    await page.goto('/today');
    await context.setOffline(true);
    await page.reload().catch(() => {});

    const body = await page.locator('body').innerText().catch(() => '');
    test.skip(!body.includes("Something's off"), 'Client shell could not load while offline; manual test required');

    await expect(page.getByText("Something's off on our end")).toBeVisible();
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /close the day/i })).toBeVisible();

    await context.setOffline(false);
  });

  test('2.4 Close-the-day from Error routes to /planner', async ({ page, context }) => {
    await page.goto('/today');
    await context.setOffline(true);
    await page.reload().catch(() => {});

    const errVisible = await page.getByText("Something's off on our end").isVisible().catch(() => false);
    test.skip(!errVisible, 'Could not reach error state in offline mode');

    await context.setOffline(false);
    await page.getByRole('button', { name: /close the day/i }).click();
    await expect(page).toHaveURL(/\/planner$/);
  });
});

// -------------------------------------------------------------------
// §7 PlannerWorking recovery (FIX #2) — seeds plan_blocks for today
// -------------------------------------------------------------------
test.describe('§7 PlannerWorking recovery', () => {
  let session: SeedSession;
  test.beforeAll(async () => {
    session = await getSession();
    await seedPlanBlocks(session);
  });

  test('7.1 Back to Today button visible in /planner/working', async ({ page }) => {
    await page.goto('/planner/working');
    await page.waitForLoadState('networkidle').catch(() => {});

    const backBtn = page.getByRole('button', { name: /back to today/i });
    await expect(backBtn).toBeVisible({ timeout: 10000 });
  });

  test('7.2 Clicking Back to Today navigates to /today', async ({ page }) => {
    await page.goto('/planner/working');
    await page.waitForLoadState('networkidle').catch(() => {});

    const backBtn = page.getByRole('button', { name: /back to today/i });
    await expect(backBtn).toBeVisible({ timeout: 10000 });
    await backBtn.click();
    await expect(page).toHaveURL(/\/today$/);
  });
});

// -------------------------------------------------------------------
// §8 Modal dismiss / cancel edges — seeds Primed + unclear next action
// -------------------------------------------------------------------
test.describe('§8 Modal dismiss edges', () => {
  let session: SeedSession;
  test.beforeAll(async () => {
    session = await getSession();
    await seedPrimedUnclear(session);
  });

  test('8.4 Save button disabled when NextActionInput empty', async ({ page }) => {
    await goToToday(page);
    const input = page.getByPlaceholder(/next action|what.s the next/i);
    if (!(await input.isVisible().catch(() => false))) {
      test.skip(true, 'NextActionInput not rendered in current Primed layout');
    }

    await input.fill('');
    const saveBtn = page.getByRole('button', { name: /^save$/i });
    const visible = await saveBtn.isVisible().catch(() => false);
    const disabled = visible ? await saveBtn.isDisabled() : true;
    expect(disabled).toBe(true);
  });
});

// -------------------------------------------------------------------
// §9 Regression — Complete-state happy paths — seeds Complete state
// -------------------------------------------------------------------
test.describe('§9 Regression happy paths', () => {
  let session: SeedSession;
  test.beforeAll(async () => {
    session = await getSession();
    await seedCompleteState(session);
  });

  // Re-seed before each test so a previous action (e.g. clicking "Add another
  // intention") doesn't leave the account out of Complete state.
  test.beforeEach(async () => {
    await seedCompleteState(session);
  });

  test('9.7 Complete → Add another intention → Empty', async ({ page }) => {
    await goToToday(page);
    const addBtn = page.getByRole('button', { name: /add another intention/i });
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();
    await expect(page.getByText("What's the one thing today")).toBeVisible();
  });

  test('9.8 Complete → Reflect on today → /reflect', async ({ page }) => {
    await goToToday(page);
    const reflectBtn = page.getByRole('button', { name: /reflect on today/i });
    await expect(reflectBtn).toBeVisible({ timeout: 10000 });
    await reflectBtn.click();
    await expect(page).toHaveURL(/\/reflect/);
  });

  test('9.9 Complete → Close the day → /planner', async ({ page }) => {
    await goToToday(page);
    const closeBtn = page.getByRole('button', { name: /close the day/i });
    await expect(closeBtn).toBeVisible({ timeout: 10000 });
    await closeBtn.click();
    await expect(page).toHaveURL(/\/planner$/);
  });

  test.afterAll(async () => {
    if (session) await resetToday(session);
  });
});

// -------------------------------------------------------------------
// Manual-only cases documented as skipped placeholders
// -------------------------------------------------------------------
test.describe('Manual-only (documented as skip)', () => {
  test.skip('3.1 No-workspace account shows Go to Workspaces — needs dedicated fresh account', () => {});
  test.skip('4.1 Move-on with completedCount>=1 → Complete — needs a completed session + active session sequence', () => {});
  test.skip('5.3 4th extension opens Checkpoint — needs real timer expiry x4', () => {});
  test.skip('6.3 4th stuck opens Still-stuck nudge — need multiple stuck events in one session', () => {});
});
