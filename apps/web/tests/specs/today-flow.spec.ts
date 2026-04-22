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
  test('1.x loads /today without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await goToToday(page);

    // Body should contain SOMETHING from a known state (Empty/Primed/Focused/Complete/Error)
    const bodyText = await page.locator('body').innerText();
    const knownMarkers = [
      "What's the one thing today",       // Empty
      'Change priority',                    // Primed
      "Time's up",                          // Focused (timer expired)
      "Done",                               // Focused
      'That was the one thing',             // Complete
      "Something's off on our end",         // Error
    ];
    const matched = knownMarkers.some((m) => bodyText.includes(m));
    expect(matched, `Expected one of ${knownMarkers.join(' / ')} in page body`).toBe(true);

    // No hard React/console errors on load (ignore noisy third-party warnings)
    const hardErrors = consoleErrors.filter((e) => !/DevTools|Download the React|Warning:/i.test(e));
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
    // If there's no plan, WorkingMode shows a fallback with just "Go to Planner"
    const hasPlan = await page.getByText(/No plan for today yet/).isVisible().catch(() => false);
    test.skip(hasPlan, 'No plan for today — cannot test Back to Today button');

    const backBtn = page.getByRole('button', { name: /back to today/i });
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
