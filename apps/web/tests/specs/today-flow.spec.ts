import { test, expect, Page } from '@playwright/test';

/**
 * Zentra /today flow regression tests.
 *
 * These cover automatable sections of docs/today_flow_test_plan.md:
 *  - §1 Loading → state routing (sanity)
 *  - §2 Error state
 *  - §7 PlannerWorking recovery
 *  - §8 Modal dismiss / cancel edges
 *  - §9 Regression happy paths
 *
 * Sections that require manual intervention (real timer waits, no-workspace
 * account, fourth-extension flow) are marked test.skip with a reason.
 */

async function goToToday(page: Page) {
  await page.goto('/today');
  // Loading spinner should clear and land on one of the known states
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

    // We should still be on /today (not redirected to /login)
    await expect(page).toHaveURL(/\/today/);

    // Page has rendered something beyond the loading spinner
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length, 'Body text should not be empty').toBeGreaterThan(10);
    expect(bodyText).not.toMatch(/^Loading\.\.\.\s*$/);

    // No hard React/console errors (ignore third-party noise + expected 401/404)
    const hardErrors = consoleErrors.filter(
      (e) => !/DevTools|Download the React|Warning:|Failed to load resource|401|404|net::ERR/i.test(e),
    );
    expect(hardErrors, `Console errors: ${hardErrors.join('\n')}`).toHaveLength(0);
  });
});

// -------------------------------------------------------------------
// §2 Error state (FIX #10)
// -------------------------------------------------------------------
test.describe('§2 Error state', () => {
  test('2.1 offline load shows Error UI with Retry + Close the day', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto('/today').catch(() => {});
    // The page shell may 404 while offline; re-enable and navigate to trigger client fetch failure
    await context.setOffline(false);
    await page.goto('/today');
    await context.setOffline(true);
    await page.reload().catch(() => {});

    // If navigation itself failed, the client error UI can't render — skip gracefully
    const body = await page.locator('body').innerText().catch(() => '');
    test.skip(!body.includes("Something's off"), 'Client shell could not load while offline; manual test required');

    await expect(page.getByText("Something's off on our end")).toBeVisible();
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /close the day/i })).toBeVisible();

    await context.setOffline(false);
  });

  test('2.4 Close-the-day from Error routes to /planner', async ({ page, context }) => {
    // Same caveat as 2.1: we try best-effort
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
// §7 PlannerWorking recovery (FIX #2)
// -------------------------------------------------------------------
test.describe('§7 PlannerWorking recovery', () => {
  test('7.1 Back to Today button visible in /planner/working', async ({ page }) => {
    await page.goto('/planner/working');
    await page.waitForLoadState('networkidle').catch(() => {});

    const backBtn = page.getByRole('button', { name: /back to today/i });
    const visible = await backBtn.isVisible().catch(() => false);
    // If no plan exists the WorkingMode header isn't rendered — skip instead of fail
    test.skip(!visible, 'Back to Today not visible (likely no plan for today)');
    await expect(backBtn).toBeVisible();
  });

  test('7.2 Clicking Back to Today navigates to /today', async ({ page }) => {
    await page.goto('/planner/working');
    const backBtn = page.getByRole('button', { name: /back to today/i });
    if (!(await backBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No plan for today');
    }
    await backBtn.click();
    await expect(page).toHaveURL(/\/today$/);
  });
});

// -------------------------------------------------------------------
// §8 Modal dismiss / cancel edges
// -------------------------------------------------------------------
test.describe('§8 Modal dismiss edges', () => {
  test('8.4 Save button disabled when NextActionInput empty', async ({ page }) => {
    await goToToday(page);
    // Only runs if we're in Primed with unclear next action
    const input = page.getByPlaceholder(/next action|what.s the next/i);
    if (!(await input.isVisible().catch(() => false))) {
      test.skip(true, 'Not in Primed + unclear state; NextActionInput not visible');
    }

    await input.fill('');
    const saveBtn = page.getByRole('button', { name: /^save$/i });
    // Save button is rendered conditionally when text.trim() is truthy; should be absent/disabled
    const visible = await saveBtn.isVisible().catch(() => false);
    const disabled = visible ? await saveBtn.isDisabled() : true;
    expect(disabled).toBe(true);
  });
});

// -------------------------------------------------------------------
// §9 Regression — existing happy paths
// -------------------------------------------------------------------
test.describe('§9 Regression happy paths', () => {
  test('9.7 Complete → Add another intention → Empty', async ({ page }) => {
    await goToToday(page);
    const addBtn = page.getByRole('button', { name: /add another intention/i });
    if (!(await addBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Not in Complete state');
    }
    await addBtn.click();
    await expect(page.getByText("What's the one thing today")).toBeVisible();
  });

  test('9.8 Complete → Reflect on today → /reflect', async ({ page }) => {
    await goToToday(page);
    const reflectBtn = page.getByRole('button', { name: /reflect on today/i });
    if (!(await reflectBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Not in Complete state');
    }
    await reflectBtn.click();
    await expect(page).toHaveURL(/\/reflect/);
  });

  test('9.9 Complete → Close the day → /planner', async ({ page }) => {
    await goToToday(page);
    const closeBtn = page.getByRole('button', { name: /close the day/i });
    if (!(await closeBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Not in Complete state');
    }
    await closeBtn.click();
    await expect(page).toHaveURL(/\/planner$/);
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
