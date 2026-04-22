/**
 * API-driven seed helpers for E2E tests.
 *
 * All helpers talk directly to the Zentra API (bypassing the UI) to set the
 * test account into a known state before UI tests run. This lets us exercise
 * the mutually-exclusive /today states (Primed / Complete / WorkingMode plan)
 * from a single shared test account.
 */

const API_BASE =
  process.env.ZENTRA_API_URL ||
  (process.env.ZENTRA_BASE_URL ? `${process.env.ZENTRA_BASE_URL.replace(/\/$/, '')}/api` : 'https://usezentra.app/api');

const EMAIL = process.env.ZENTRA_TEST_EMAIL!;
const PASSWORD = process.env.ZENTRA_TEST_PASSWORD!;

export interface SeedSession {
  token: string;
  userId: string;
  workspaceId: string;
}

async function apiFetch<T>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function login(): Promise<{ token: string; userId: string }> {
  if (!EMAIL || !PASSWORD) throw new Error('ZENTRA_TEST_EMAIL / ZENTRA_TEST_PASSWORD required');
  const res = await apiFetch<{ accessToken: string; user: { id: string } }>(null, 'POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  return { token: res.accessToken, userId: res.user.id };
}

async function getOrCreateWorkspace(token: string): Promise<string> {
  const res = await apiFetch<{ items: Array<{ id: string; name: string }> }>(token, 'GET', '/workspaces');
  if (res.items && res.items.length > 0) return res.items[0].id;
  const created = await apiFetch<{ id: string }>(token, 'POST', '/workspaces', { name: 'E2E Workspace' });
  return created.id;
}

export async function getSession(): Promise<SeedSession> {
  const { token, userId } = await login();
  const workspaceId = await getOrCreateWorkspace(token);
  return { token, userId, workspaceId };
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local TZ
}

/**
 * Put the test account into a neutral state for /today:
 *  - abandon any active focus session
 *  - clear today's priority
 * Note: we intentionally do NOT delete completed sessions from today — those
 * will make state=complete when there's no priority. When a test needs a
 * specific downstream state, it seeds after calling this.
 */
export async function resetToday(s: SeedSession): Promise<void> {
  // Abandon active session if any
  try {
    const { session } = await apiFetch<{ session: { id: string } | null }>(
      s.token,
      'GET',
      '/focus/sessions/active',
    );
    if (session?.id) {
      await apiFetch(s.token, 'PATCH', `/focus/sessions/${session.id}/abandon`, {});
    }
  } catch {
    /* ignore */
  }
  // Clear priority
  try {
    await apiFetch(s.token, 'DELETE', '/priority/today');
  } catch {
    /* already none */
  }
}

/** Create a task (returns the task id). */
async function createTask(s: SeedSession, title: string, nextAction?: string): Promise<string> {
  const body: Record<string, unknown> = {
    title,
    status: 'pending',
    priority: 'high',
  };
  if (nextAction) body.nextAction = nextAction;
  const task = await apiFetch<{ id: string }>(s.token, 'POST', `/workspaces/${s.workspaceId}/tasks`, body);
  return task.id;
}

async function setPriority(s: SeedSession, taskId: string): Promise<void> {
  await apiFetch(s.token, 'POST', '/priority/today', { taskId });
}

/**
 * Primed + unclear-next-action state.
 * Used by §8: NextActionInput renders when nextActionState === 'unclear'.
 */
export async function seedPrimedUnclear(s: SeedSession): Promise<string> {
  await resetToday(s);
  const id = await createTask(s, `E2E Primed ${Date.now()}`); // no nextAction → 'unclear'
  await setPriority(s, id);
  return id;
}

/**
 * A daily_plan with plan_blocks for today.
 * Used by §7: WorkingMode requires blocks.length > 0 to render the header
 * (and therefore the "Back to Today" button).
 */
export async function seedPlanBlocks(s: SeedSession): Promise<void> {
  const date = todayISO();
  // Two simple work blocks — content is arbitrary; WorkingMode just needs blocks.length > 0
  const blocks = [
    { type: 'work', start: '09:00', end: '10:00', tasks: [] as string[] },
    { type: 'break', start: '10:00', end: '10:15', tasks: [] as string[] },
    { type: 'work', start: '10:15', end: '11:15', tasks: [] as string[] },
  ];
  await apiFetch(s.token, 'POST', '/planner/ai/apply-plan', { date, blocks });
}

/**
 * Complete state on /today: priority task's focus session is completed.
 * Used by §9 regression tests (Add another intention / Reflect / Close the day).
 */
export async function seedCompleteState(s: SeedSession): Promise<void> {
  await resetToday(s);
  const taskId = await createTask(s, `E2E Complete ${Date.now()}`, 'Ship it');
  await setPriority(s, taskId);
  const { session } = await apiFetch<{ session: { id: string } }>(s.token, 'POST', '/focus/sessions', {
    taskId,
    plannedMinutes: 25,
  });
  await apiFetch(s.token, 'PATCH', `/focus/sessions/${session.id}/complete`, {});
}
