# Zentra E2E tests

Playwright tests covering the `/today` flow per
[`docs/today_flow_test_plan.md`](../../../docs/today_flow_test_plan.md).

## Setup

From this directory (`apps/web/tests/`):

```bash
npm install
npx playwright install chromium
```

Set test credentials (bash/wsl):

```bash
export ZENTRA_TEST_EMAIL="you+test@example.com"
export ZENTRA_TEST_PASSWORD="…"
# Optional — defaults to https://usezentra.app
export ZENTRA_BASE_URL="https://usezentra.app"
```

Or PowerShell:

```powershell
$env:ZENTRA_TEST_EMAIL = "you+test@example.com"
$env:ZENTRA_TEST_PASSWORD = "…"
```

## Run

```bash
# All tests, headless
npm test

# Watch in Playwright UI
npm run test:ui

# Headed (see browser)
npm run test:headed

# Open last HTML report
npm run report
```

## What's covered

| Section | Status |
|---|---|
| §1 Loading → state routing (sanity) | ✅ automated |
| §2 Error state (offline) | ⚠️ best-effort (depends on shell caching) |
| §7 PlannerWorking recovery | ✅ automated (skips if no plan) |
| §8 Modal dismiss edges | ✅ partial (NextActionInput empty) |
| §9 Regression happy paths | ✅ automated (skips if wrong state) |
| §3 No-workspace flow | ⏭️ manual — needs fresh account |
| §4 AfterMoveOn → Complete | ⏭️ manual — sequence-dependent |
| §5 Extension checkpoint (4th +15) | ⏭️ manual — real timer |
| §6 Stuck nudge (4th stuck) | ⏭️ manual — multiple stuck events |

The "skip if state mismatch" pattern means tests pass no-op when the account
isn't in the right state. Run multiple times with different seed states, or
prefer running them right after the relevant setup (see the test plan).

## Auth

On first run a `setup` project logs in and writes `auth.json`. Subsequent
tests reuse that session. If it expires, delete `auth.json` and rerun.

## Files

- `playwright.config.ts` — config, auth persistence
- `specs/auth.setup.ts` — login once, save `auth.json`
- `specs/today-flow.spec.ts` — the flow tests
