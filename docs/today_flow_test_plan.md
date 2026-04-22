# Zentra `/today` Flow — Test Plan

Environment: https://usezentra.app
Log in with a test account that has at least one workspace and a few open tasks.

## Pre-test setup

1. Open https://usezentra.app/today in a fresh browser tab (hard refresh, `Ctrl+Shift+R`).
2. Open DevTools → Network tab, set to "Preserve log".
3. Have a second browser profile / incognito ready for the "no-workspace" test.

---

## 1. Loading → state routing (sanity)

| # | Setup | Action | Expected |
|---|---|---|---|
| 1.1 | No priority set, no active session | Open `/today` | Shows **Empty** (EmptyPriorityPrompt) |
| 1.2 | Priority set, no session | Open `/today` | Shows **Primed** with Start button |
| 1.3 | Active focus session running | Open `/today` | Shows **Focused** (timer + Done / Move on) |
| 1.4 | Priority marked done today | Open `/today` | Shows **Complete** (CompleteDayView) |

## 2. Error state (FIX #10)

| # | Setup | Action | Expected |
|---|---|---|---|
| 2.1 | DevTools → Network → "Offline" | Reload `/today` | Shows **"Something's off on our end"** with **Retry** + **Close the day** buttons |
| 2.2 | From error screen | Click **Retry** while still offline | Stays on error screen |
| 2.3 | Go back online, click **Retry** | | Returns to correct state (Empty/Primed/Focused) |
| 2.4 | Click **Close the day** | | Navigates to `/planner` |

## 3. Empty → Workspaces recovery (FIX #1)

| # | Setup | Action | Expected |
|---|---|---|---|
| 3.1 | User with **no workspaces** (fresh account or delete all) | Type a task, click "Set as today's priority" | Error message + **Go to Workspaces** button appears |
| 3.2 | Click **Go to Workspaces** | | Navigates to `/workspaces` |
| 3.3 | Create a workspace there, navigate back to `/today` | | Should now be able to set priority without error |

## 4. AfterMoveOn → Complete (FIX #3)

| # | Setup | Action | Expected |
|---|---|---|---|
| 4.1 | Complete one session today (have `completedCount ≥ 1`), start a second session | During session, click "Move on" → pick a reason → submit | Lands on **Complete** (CompleteDayView), NOT Empty |
| 4.2 | Zero completed sessions today, start session, Move on with reason | | Lands on **Empty** (old behavior still correct when nothing done) |
| 4.3 | "Move on" → **Keep going** button | | Modal closes, timer still running, no state change |
| 4.4 | "Move on" → **Skip, just end it** | | Returns to **Primed** |

## 5. Extension limit → Checkpoint (FIX #7)

| # | Setup | Action | Expected |
|---|---|---|---|
| 5.1 | Start a 1-minute session (or wait out 25 min) | When timer hits 0 → click **+15 min** | Timer extends, reloads. Count = 1. |
| 5.2 | Wait again → **+15 min** (count=2) → **+15 min** (count=3) | | Each extends normally |
| 5.3 | 4th extend attempt (+15 or +25) | | **Checkpoint sheet opens**: "You've extended a few times." with: Continue once more / Move on / Adjust next action / Reflect on today |
| 5.4 | Click **Continue once more** | | Extends +15 and reloads |
| 5.5 | Click **Move on** from Checkpoint | | Opens MoveOnPrompt |
| 5.6 | Click **Reflect on today** | | Navigates to `/reflect` |
| 5.7 | Click backdrop | | Closes Checkpoint, stays in Focused |

> Note: `extensionCount` is component-local, so a page reload resets it. That's intentional (each fresh session starts at 0).

## 6. Stuck limit → nudge (FIX #8)

| # | Setup | Action | Expected |
|---|---|---|---|
| 6.1 | In Focused state, click **I'm stuck** | Pick "Take a short break" | StuckPrompt closes, session continues. Count = 1. |
| 6.2 | Click **I'm stuck** again → "I found a way to start" (count=2) → again → "Take a short break" (count=3) | | Each opens StuckPrompt normally |
| 6.3 | 4th click on **I'm stuck** | | **"Still stuck?" sheet opens** with: Change task / Change priority / Push through |
| 6.4 | Click **Change task** | | Opens MoveOnPrompt |
| 6.5 | Click **Change priority** | | Abandons session → returns to Primed/Empty |
| 6.6 | Click **Push through** | | Sheet closes, session continues. Further "I'm stuck" clicks re-open the nudge (no StuckPrompt). |

## 7. PlannerWorking recovery (FIX #2)

| # | Setup | Action | Expected |
|---|---|---|---|
| 7.1 | Have a plan for today in `/planner`, go to `/planner/working` | Find the **Back to Today** button in the header (next to Exit) | Button visible |
| 7.2 | Click **Back to Today** | | Navigates to `/today` |
| 7.3 | Click **Exit** | | Navigates to `/planner` (existing behavior) |

## 8. Modal dismiss / cancel edges (regression)

| # | Setup | Action | Expected |
|---|---|---|---|
| 8.1 | Open StuckPrompt | Click backdrop | Closes, back to Focused |
| 8.2 | Open MoveOnPrompt | Click backdrop | Closes, back to Focused |
| 8.3 | Open MoveOnPrompt | Click **Keep going** | Closes, session continues |
| 8.4 | Open NextActionInput | Clear text, Save disabled | Save button should not submit empty |
| 8.5 | Checkpoint sheet open | Click backdrop | Closes, back to Focused (done-prompt state preserved) |
| 8.6 | StuckLimit sheet open | Click backdrop | Closes, back to Focused |

## 9. Regression — existing flows still work

| # | Flow | Expected |
|---|---|---|
| 9.1 | Empty → type task → Set as priority | Lands in Primed |
| 9.2 | Empty → pick existing task dropdown | Lands in Primed |
| 9.3 | Empty → "Suggest from yesterday" | Fills input (no regression) |
| 9.4 | Primed → Start 25 min | Lands in Focused |
| 9.5 | Focused → Done (before timer) | Lands in Complete |
| 9.6 | Focused → timer expires → Mark done | Lands in Complete |
| 9.7 | Complete → Add another intention | Lands in Empty |
| 9.8 | Complete → Reflect | Navigates to `/reflect` |
| 9.9 | Complete → Close the day | Navigates to `/planner` |
| 9.10 | Stuck → "Break it into smaller steps" | AI decompose runs, micro-steps render in Focused |

## 10. Smoke test — console + network

- No red errors in browser console on any transition
- No 500 responses on `/priority/today`, `/focus/sessions/active`, `/focus/sessions/today`
- `/focus/sessions/{id}/extend` returns 200 on each allowed extension

---

## Quick manual checklist

- [ ] 2.1 Error UI shown when offline
- [ ] 2.4 Close-the-day routes to `/planner`
- [ ] 3.1 Go-to-Workspaces button appears for no-workspace user
- [ ] 4.1 Move-on with `completedCount ≥ 1` routes to Complete
- [ ] 5.3 4th extension opens Checkpoint
- [ ] 6.3 4th stuck opens Still-stuck nudge
- [ ] 7.1 Back-to-Today button visible in `/planner/working`
- [ ] 8.x All modal backdrops close cleanly
- [ ] 9.x No regressions in normal happy paths

## Known limitations (not in scope for this test pass)

- `SuggestedPriority` Accept/Reject UI (fix #4) not implemented — AI suggest still auto-fills input
- Extension/Stuck counters are client-side only; resetting on page reload is intentional
- `NextActionInput` validation (fix #5) already correct in original code — no new test needed

---

## Related docs

- Flow diagram: [today_user_flow.md](today_user_flow.md)
- Mermaid source: [today_user_flow.mmd](today_user_flow.mmd)
- Exports: [today_user_flow.svg](today_user_flow.svg), [today_user_flow.png](today_user_flow.png)
