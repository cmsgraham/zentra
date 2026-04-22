import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError } from '../../lib/errors.js';
import { getEnv } from '../../lib/env.js';

const OPENAI_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const ROUTE_TIMEOUT_MS = 120_000;
const MAX_COMPLETION_TOKENS = 8192; // plenty for a day plan JSON (matches non-stream path)

/**
 * Shared state object so the stream can report the final finish_reason back
 * to the caller (needed to distinguish truncation from clean completion).
 */
type StreamMeta = { finishReason: string | null };

/**
 * Strip markdown code fences and locate the outer JSON object. Returns the
 * best-effort JSON string, or the original input if nothing matches.
 */
function extractJsonCandidate(raw: string): string {
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  if (fence) s = fence[1].trim();
  // Fall back to first { ... last }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return s.slice(first, last + 1);
  }
  return s;
}

/**
 * Stream chat completion from OpenAI. Yields content deltas as they arrive.
 * Falls back to throwing if the stream fails; caller should handle retry.
 * The optional `meta` object is populated with finish_reason when the stream ends.
 */
async function* streamOpenAI(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  meta?: StreamMeta,
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      response_format: { type: 'json_object' },
      stream: true,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errBody = await response.text();
    throw new Error(`OpenAI returned ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines (data: {...}\n\n)
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const obj = JSON.parse(data);
          const finish = obj.choices?.[0]?.finish_reason;
          if (finish && meta) meta.finishReason = finish;
          const delta = obj.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
        } catch {
          // skip malformed chunk
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
    try { reader.releaseLock(); } catch { /* noop */ }
  }
}

async function callOpenAI(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  logger: { info: Function; error: Function },
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_completion_tokens: 8192,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errBody = await response.text();
        logger.error({ status: response.status, errBody, attempt }, 'OpenAI API error');
        throw new Error(`OpenAI returned ${response.status}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      const finishReason = data.choices?.[0]?.finish_reason;

      if (!content) {
        logger.error({ attempt, finishReason }, 'OpenAI returned empty content');
        // If finish_reason is 'length', token limit was hit with no usable content — don't retry, it'll happen again
        if (finishReason === 'length') {
          throw new BadRequestError('AI response was too large. Try selecting fewer tasks or a single workspace.');
        }
        lastError = new Error('AI returned empty response');
        if (attempt < MAX_RETRIES) continue;
        throw lastError;
      }

      // If truncated but we got partial content, try to use it
      if (finishReason === 'length') {
        logger.info({ attempt }, 'OpenAI response truncated, using partial content');
      }

      return content;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        throw new BadRequestError('AI request timed out. Please try again.');
      }

      lastError = err;
      if (attempt >= MAX_RETRIES) throw err;

      logger.info({ attempt, err: err.message }, 'Retrying OpenAI call');
    }
  }

  throw lastError || new Error('OpenAI call failed');
}

const generatePlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM').default('09:00'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM').default('18:00'),
  energyLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  focusBlockMinutes: z.coerce.number().int().min(15).max(180).default(90),
  workspaceId: z.string().uuid().optional(),
});

const applyPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  blocks: z.array(z.object({
    start: z.string(),
    end: z.string(),
    type: z.string(),
    tasks: z.array(z.string()),
  })),
});

const SYSTEM_PROMPT = `You are a day-structuring engine.

You receive a pre-filtered set of tasks that already fit within the available time. Your ONLY job is to arrange them into time blocks.

## STRICT RULES

1. You must NOT add, invent, or pull any tasks beyond what is provided
2. You must NOT modify task titles — use them EXACTLY as given
3. Schedule in this priority: mustDo → goals → inProgress → optional
4. Respect fixed events (appointments) — NEVER move or schedule over them
5. NEVER exceed the end time — finishing early is always preferred
6. Include 10–15 min breaks every 90–120 min of work
7. Schedule complex tasks early (morning/high-energy), simple tasks later
8. Group quick tasks (≤15 min) together when possible
9. Each task has a complexity field (simple/moderate/complex) — use it for ordering
10. The deferred array should normally be empty — tasks have been pre-filtered to fit

## OUTPUT FORMAT (STRICT JSON, no markdown)

{
  "plan": [
    {
      "start": "09:00",
      "end": "10:30",
      "type": "focus",
      "tasks": ["Task title exactly as given"]
    },
    {
      "start": "10:30",
      "end": "10:45",
      "type": "break",
      "tasks": ["Break"]
    }
  ],
  "deferred": [
    { "title": "Task title that did not fit", "reason": "not enough time" }
  ]
}`;

export default async function plannerAIRoutes(app: FastifyInstance) {
  // Generate AI daily plan
  app.post('/planner/ai/generate-plan', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    // Route-level timeout to prevent infinite hangs
    const routeTimer = setTimeout(() => {
      if (!reply.sent) {
        reply.status(504).send({ error: 'Plan generation timed out. Please try again.' });
      }
    }, ROUTE_TIMEOUT_MS);
    try {
    const body = generatePlanSchema.parse(request.body);
    const userId = request.user.sub;
    const env = getEnv();

    if (!env.OPENAI_API_KEY) {
      throw new BadRequestError('AI features are not configured');
    }

    const today = body.date;

    const wsFilter = body.workspaceId
      ? 'AND t.workspace_id = $2'
      : '';
    const params: any[] = [userId];
    if (body.workspaceId) params.push(body.workspaceId);

    // ── 1. Fetch Today's Goals (user-selected priorities) ──
    const goalsResult = await app.pg.query(
      `SELECT g.title, g.linked_task_id, t.title as task_title, t.priority, t.estimated_minutes, t.complexity, t.status as task_status
       FROM daily_plan_goals g
       JOIN daily_plans dp ON dp.id = g.daily_plan_id
       LEFT JOIN tasks t ON t.id = g.linked_task_id
       WHERE dp.user_id = $1 AND dp.plan_date = $2 AND dp.workspace_id IS NULL
         AND g.status != 'done'
       ORDER BY g.sort_order`,
      [userId, today],
    );
    const goalTaskIds = new Set(goalsResult.rows.filter((g: any) => g.linked_task_id).map((g: any) => g.linked_task_id));

    // ── 2. Fetch tasks from user's workspaces ──
    const nextParamIdx = params.length + 1;
    const tasksResult = await app.pg.query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.estimated_minutes, t.complexity, t.has_segments
       FROM tasks t
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = $1
       WHERE t.status != 'done' AND t.archived = false ${wsFilter}
         AND (t.assignee_id IS NULL OR t.assignee_id = $1)
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         t.created_at ASC
       LIMIT 30`,
      params,
    );

    // ── 2b. Expand parent tasks with segments into individual unfinished segments ──
    const parentIds = tasksResult.rows.filter((t: any) => t.has_segments).map((t: any) => t.id);
    let segmentsByParent: Record<string, any[]> = {};
    if (parentIds.length > 0) {
      const segResult = await app.pg.query(
        `SELECT * FROM task_segments WHERE parent_task_id = ANY($1) AND status != 'done' ORDER BY sequence_number`,
        [parentIds],
      );
      for (const s of segResult.rows) {
        if (!segmentsByParent[s.parent_task_id]) segmentsByParent[s.parent_task_id] = [];
        segmentsByParent[s.parent_task_id].push(s);
      }
    }

    // ── 3. Fetch existing appointments ──
    const apptsResult = await app.pg.query(
      `SELECT title, starts_at, ends_at FROM appointments
       WHERE owner_user_id = $1 AND starts_at::date = $2
       ORDER BY starts_at`,
      [userId, today],
    );

    const existingAppointments = apptsResult.rows.map((a: any) => ({
      title: a.title,
      start: new Date(a.starts_at).toTimeString().slice(0, 5),
      end: new Date(a.ends_at).toTimeString().slice(0, 5),
    }));

    // ── 4. Categorize tasks ──
    const complexityLabels = ['simple', 'moderate', 'complex'];
    function formatTask(t: any) {
      let estimatedMinutes = t.estimated_minutes;
      if (!estimatedMinutes) {
        estimatedMinutes = 30;
        if (t.priority === 'critical' || t.priority === 'high') estimatedMinutes = 60;
        if (t.priority === 'low') estimatedMinutes = 15;
      }
      const complexity = t.complexity || 1;
      let type = 'focus';
      const titleLower = (t.title || '').toLowerCase();
      if (titleLower.includes('call') || titleLower.includes('meeting') || titleLower.includes('sync')) {
        type = 'call';
      } else if (estimatedMinutes <= 15) {
        type = 'quick';
      }
      return { title: t.title, priority: t.priority, estimated_minutes: estimatedMinutes, complexity: complexityLabels[complexity - 1], type };
    }

    const categorized = {
      mustDo: [] as any[],
      goals: [] as any[],
      inProgress: [] as any[],
      optional: [] as any[],
    };

    const usedIds = new Set<string>();

    // Goals from daily_plan_goals (user-selected)
    for (const g of goalsResult.rows) {
      const taskData = g.linked_task_id
        ? { title: g.task_title || g.title, priority: g.priority || 'medium', estimated_minutes: g.estimated_minutes, complexity: g.complexity, task_status: g.task_status }
        : { title: g.title.replace(/^\[\d{2}:\d{2}\]\s*/, ''), priority: 'medium', estimated_minutes: null, complexity: 1, task_status: null };
      categorized.goals.push(formatTask(taskData));
      if (g.linked_task_id) usedIds.add(g.linked_task_id);
    }

    // Categorize remaining tasks
    for (const t of tasksResult.rows) {
      if (usedIds.has(t.id)) continue;
      usedIds.add(t.id);

      const dueDateStr = typeof t.due_date === 'string' ? t.due_date.slice(0, 10) : t.due_date instanceof Date ? t.due_date.toISOString().slice(0, 10) : null;
      const isOverdue = dueDateStr !== null && dueDateStr < today;
      const isDueToday = dueDateStr !== null && dueDateStr === today;
      const isCritical = t.priority === 'critical';
      const isInProgress = t.status === 'in_progress';

      // If parent has segments, schedule unfinished segments instead
      if (t.has_segments && segmentsByParent[t.id]?.length > 0) {
        const segs = segmentsByParent[t.id];
        for (const seg of segs) {
          // Use segment's own due date if set, otherwise fall back to parent's
          const segDueDateStr = seg.due_date
            ? (typeof seg.due_date === 'string' ? seg.due_date.slice(0, 10) : seg.due_date instanceof Date ? seg.due_date.toISOString().slice(0, 10) : null)
            : dueDateStr;
          const segOverdue = segDueDateStr !== null && segDueDateStr < today;
          const segDueToday = segDueDateStr !== null && segDueDateStr === today;

          const segFormatted = formatTask({
            title: seg.title,
            priority: t.priority,
            estimated_minutes: seg.estimated_minutes || (t.estimated_minutes ? Math.ceil(t.estimated_minutes / seg.total_segments) : null),
            complexity: t.complexity,
          });
          if (segOverdue || segDueToday || isCritical) {
            categorized.mustDo.push(segFormatted);
          } else if (isInProgress || seg.status === 'in_progress') {
            categorized.inProgress.push(segFormatted);
          } else {
            categorized.optional.push(segFormatted);
          }
        }
        continue;
      }

      const formatted = formatTask(t);

      if (isOverdue || isDueToday || isCritical) {
        categorized.mustDo.push(formatted);
      } else if (isInProgress) {
        categorized.inProgress.push(formatted);
      } else {
        categorized.optional.push(formatted);
      }
    }

    // ── 5. Enforce capacity budget — pre-defer overflow ──
    const [startH, startM] = body.startTime.split(':').map(Number);
    const [endH, endM] = body.endTime.split(':').map(Number);
    const totalWindowMinutes = (endH * 60 + endM) - (startH * 60 + startM);

    // Subtract appointment time
    const appointmentMinutes = existingAppointments.reduce((sum: number, a: any) => {
      const [aStartH, aStartM] = a.start.split(':').map(Number);
      const [aEndH, aEndM] = a.end.split(':').map(Number);
      return sum + ((aEndH * 60 + aEndM) - (aStartH * 60 + aStartM));
    }, 0);

    // Available = window minus appointments (breaks are added by the AI within this)
    const maxWorkMinutes = totalWindowMinutes - appointmentMinutes;

    // Walk categories in priority order, filling up to capacity
    const scheduled = {
      mustDo: [] as any[],
      goals: [] as any[],
      inProgress: [] as any[],
      optional: [] as any[],
    };
    const preDeferred: { title: string; reason: string }[] = [];
    let usedMinutes = 0;

    function fillCategory(source: any[], key: keyof typeof scheduled) {
      for (const task of source) {
        if (usedMinutes + task.estimated_minutes <= maxWorkMinutes) {
          usedMinutes += task.estimated_minutes;
          scheduled[key].push(task);
        } else {
          preDeferred.push({ title: task.title, reason: 'not enough time in the day' });
        }
      }
    }

    // mustDo always goes in (non-negotiable)
    for (const task of categorized.mustDo) {
      usedMinutes += task.estimated_minutes;
      scheduled.mustDo.push(task);
    }
    fillCategory(categorized.goals, 'goals');
    fillCategory(categorized.inProgress, 'inProgress');
    // Optional tasks are NOT auto-scheduled — user must add them as goals first
    for (const task of categorized.optional) {
      preDeferred.push({ title: task.title, reason: 'not selected as a goal for today' });
    }

    const totalScheduled = scheduled.mustDo.length + scheduled.goals.length
      + scheduled.inProgress.length + scheduled.optional.length;

    if (totalScheduled === 0) {
      clearTimeout(routeTimer);
      return { plan: [], deferred: preDeferred, message: 'No tasks to schedule' };
    }

    app.log.info({
      capacity: maxWorkMinutes,
      usedMinutes,
      scheduled: totalScheduled,
      deferred: preDeferred.length,
      breakdown: {
        mustDo: scheduled.mustDo.length,
        goals: scheduled.goals.length,
        inProgress: scheduled.inProgress.length,
        optional: scheduled.optional.length,
      },
    }, 'AI planner: capacity budget');

    const userPrompt = `User availability:
* Start time: ${body.startTime}
* End time: ${body.endTime} (HARD DEADLINE — prefer ending early over going past this)
* Available work time: ${maxWorkMinutes} minutes

Energy level: ${body.energyLevel}
Focus block preference: ${body.focusBlockMinutes} minutes

Fixed events (DO NOT move or schedule over these):
${existingAppointments.length > 0 ? JSON.stringify(existingAppointments, null, 2) : 'None'}

## Tasks to schedule — fit ALL of these into the day:
## Total estimated effort: ${usedMinutes} minutes

### mustDo (non-negotiable — overdue, due today, or critical):
${scheduled.mustDo.length > 0 ? JSON.stringify(scheduled.mustDo, null, 2) : 'None'}

### goals (user-selected priorities for today):
${scheduled.goals.length > 0 ? JSON.stringify(scheduled.goals, null, 2) : 'None'}

### inProgress (already being worked on):
${scheduled.inProgress.length > 0 ? JSON.stringify(scheduled.inProgress, null, 2) : 'None'}

### optional (if time remains):
${scheduled.optional.length > 0 ? JSON.stringify(scheduled.optional, null, 2) : 'None'}

Today's date: ${today}

Schedule complex tasks during high-energy periods (morning), simple tasks later. You have EXACTLY ${totalScheduled} tasks. Place ALL of them. End BEFORE ${body.endTime} — finishing early is always better than running over.`;

    const content = await callOpenAI(
      env.OPENAI_API_KEY,
      env.OPENAI_MODEL_TEXT,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      app.log,
    );

    // Parse and validate response (robust against code fences / prose)
    let parsed: any;
    const candidate = extractJsonCandidate(content);
    try {
      parsed = JSON.parse(candidate);
    } catch (parseErr: any) {
      app.log.error({
        err: parseErr.message,
        contentLen: content.length,
        contentHead: content.slice(0, 300),
        contentTail: content.slice(-300),
      }, 'AI JSON parse failed (non-stream)');
      throw new BadRequestError('AI returned invalid format');
    }

    if (!parsed.plan || !Array.isArray(parsed.plan)) {
      app.log.error({ parsedKeys: Object.keys(parsed || {}) }, 'AI returned JSON without valid plan array (non-stream)');
      throw new BadRequestError('AI returned invalid plan format');
    }

    // Merge pre-deferred (capacity overflow) with any AI-deferred
    const rawDeferred = parsed.deferred || [];
    const aiDeferred = rawDeferred.map((d: any) =>
      typeof d === 'string' ? { title: d, reason: '' } : { title: d.title || d, reason: d.reason || '' }
    );
    const allDeferred = [...preDeferred, ...aiDeferred];

    const totalTasks = totalScheduled + preDeferred.length;

    clearTimeout(routeTimer);
    return {
      plan: parsed.plan,
      deferred: allDeferred,
      taskCount: totalTasks,
      categorized: {
        mustDo: scheduled.mustDo.length,
        goals: scheduled.goals.length,
        inProgress: scheduled.inProgress.length,
        optional: scheduled.optional.length,
      },
    };
    } catch (err: any) {
      clearTimeout(routeTimer);
      app.log.error({ err: err.message, stack: err.stack }, 'generate-plan handler error');
      if (reply.sent) return;
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  // Apply AI plan — create goals from the scheduled blocks
  app.post('/planner/ai/apply-plan', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const body = applyPlanSchema.parse(request.body);
    const userId = request.user.sub;

    // Upsert daily plan
    let planResult = await app.pg.query(
      `SELECT id FROM daily_plans WHERE user_id = $1 AND plan_date = $2 AND workspace_id IS NULL`,
      [userId, body.date],
    );

    let planId: string;
    if (planResult.rows.length > 0) {
      planId = planResult.rows[0].id;
      // Store the plan blocks
      await app.pg.query(
        `UPDATE daily_plans SET plan_blocks = $1 WHERE id = $2`,
        [JSON.stringify(body.blocks), planId],
      );
    } else {
      const insert = await app.pg.query(
        `INSERT INTO daily_plans (user_id, plan_date, plan_blocks) VALUES ($1, $2, $3) RETURNING id`,
        [userId, body.date, JSON.stringify(body.blocks)],
      );
      planId = insert.rows[0].id;
    }

    return reply.status(201).send({
      planId,
      goalsCreated: 0,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Streaming version of generate-plan (SSE)
  // Emits events: "prefilter" → "token" (many) → "done" | "error"
  // ─────────────────────────────────────────────────────────────
  app.post('/planner/ai/generate-plan/stream', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = generatePlanSchema.parse(request.body);
    const userId = request.user.sub;
    const env = getEnv();

    if (!env.OPENAI_API_KEY) {
      throw new BadRequestError('AI features are not configured');
    }

    // Set up SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (event: string, data: unknown) => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* client disconnected */ }
    };

    // Safety timeout
    const routeTimer = setTimeout(() => {
      sendEvent('error', { message: 'Plan generation timed out' });
      try { reply.raw.end(); } catch { /* noop */ }
    }, ROUTE_TIMEOUT_MS);

    try {
      const today = body.date;
      const wsFilter = body.workspaceId ? 'AND t.workspace_id = $2' : '';
      const params: any[] = [userId];
      if (body.workspaceId) params.push(body.workspaceId);

      // Run all 3 fetches in parallel
      const [goalsResult, tasksResult, apptsResult] = await Promise.all([
        app.pg.query(
          `SELECT g.title, g.linked_task_id, t.title as task_title, t.priority, t.estimated_minutes, t.complexity, t.status as task_status
           FROM daily_plan_goals g
           JOIN daily_plans dp ON dp.id = g.daily_plan_id
           LEFT JOIN tasks t ON t.id = g.linked_task_id
           WHERE dp.user_id = $1 AND dp.plan_date = $2 AND dp.workspace_id IS NULL
             AND g.status != 'done'
           ORDER BY g.sort_order`,
          [userId, today],
        ),
        app.pg.query(
          `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.estimated_minutes, t.complexity, t.has_segments
           FROM tasks t
           JOIN workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = $1
           WHERE t.status != 'done' AND t.archived = false ${wsFilter}
             AND (t.assignee_id IS NULL OR t.assignee_id = $1)
           ORDER BY
             CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             t.created_at ASC
           LIMIT 30`,
          params,
        ),
        app.pg.query(
          `SELECT title, starts_at, ends_at FROM appointments
           WHERE owner_user_id = $1 AND starts_at::date = $2
           ORDER BY starts_at`,
          [userId, today],
        ),
      ]);

      const parentIds = tasksResult.rows.filter((t: any) => t.has_segments).map((t: any) => t.id);
      let segmentsByParent: Record<string, any[]> = {};
      if (parentIds.length > 0) {
        const segResult = await app.pg.query(
          `SELECT * FROM task_segments WHERE parent_task_id = ANY($1) AND status != 'done' ORDER BY sequence_number`,
          [parentIds],
        );
        for (const s of segResult.rows) {
          if (!segmentsByParent[s.parent_task_id]) segmentsByParent[s.parent_task_id] = [];
          segmentsByParent[s.parent_task_id].push(s);
        }
      }

      const existingAppointments = apptsResult.rows.map((a: any) => ({
        title: a.title,
        start: new Date(a.starts_at).toTimeString().slice(0, 5),
        end: new Date(a.ends_at).toTimeString().slice(0, 5),
      }));

      // Categorize
      const complexityLabels = ['simple', 'moderate', 'complex'];
      function formatTask(t: any) {
        let estimatedMinutes = t.estimated_minutes;
        if (!estimatedMinutes) {
          estimatedMinutes = 30;
          if (t.priority === 'critical' || t.priority === 'high') estimatedMinutes = 60;
          if (t.priority === 'low') estimatedMinutes = 15;
        }
        const complexity = t.complexity || 1;
        let type = 'focus';
        const titleLower = (t.title || '').toLowerCase();
        if (titleLower.includes('call') || titleLower.includes('meeting') || titleLower.includes('sync')) {
          type = 'call';
        } else if (estimatedMinutes <= 15) {
          type = 'quick';
        }
        return { title: t.title, priority: t.priority, estimated_minutes: estimatedMinutes, complexity: complexityLabels[complexity - 1], type };
      }

      const categorized = {
        mustDo: [] as any[], goals: [] as any[], inProgress: [] as any[], optional: [] as any[],
      };
      const usedIds = new Set<string>();

      for (const g of goalsResult.rows) {
        const taskData = g.linked_task_id
          ? { title: g.task_title || g.title, priority: g.priority || 'medium', estimated_minutes: g.estimated_minutes, complexity: g.complexity }
          : { title: g.title.replace(/^\[\d{2}:\d{2}\]\s*/, ''), priority: 'medium', estimated_minutes: null, complexity: 1 };
        categorized.goals.push(formatTask(taskData));
        if (g.linked_task_id) usedIds.add(g.linked_task_id);
      }

      for (const t of tasksResult.rows) {
        if (usedIds.has(t.id)) continue;
        usedIds.add(t.id);
        const dueDateStr = typeof t.due_date === 'string' ? t.due_date.slice(0, 10) : t.due_date instanceof Date ? t.due_date.toISOString().slice(0, 10) : null;
        const isOverdue = dueDateStr !== null && dueDateStr < today;
        const isDueToday = dueDateStr !== null && dueDateStr === today;
        const isCritical = t.priority === 'critical';
        const isInProgress = t.status === 'in_progress';

        if (t.has_segments && segmentsByParent[t.id]?.length > 0) {
          for (const seg of segmentsByParent[t.id]) {
            const segDueDateStr = seg.due_date
              ? (typeof seg.due_date === 'string' ? seg.due_date.slice(0, 10) : seg.due_date instanceof Date ? seg.due_date.toISOString().slice(0, 10) : null)
              : dueDateStr;
            const segOverdue = segDueDateStr !== null && segDueDateStr < today;
            const segDueToday = segDueDateStr !== null && segDueDateStr === today;
            const segFormatted = formatTask({
              title: seg.title,
              priority: t.priority,
              estimated_minutes: seg.estimated_minutes || (t.estimated_minutes ? Math.ceil(t.estimated_minutes / seg.total_segments) : null),
              complexity: t.complexity,
            });
            if (segOverdue || segDueToday || isCritical) categorized.mustDo.push(segFormatted);
            else if (isInProgress || seg.status === 'in_progress') categorized.inProgress.push(segFormatted);
            else categorized.optional.push(segFormatted);
          }
          continue;
        }

        const formatted = formatTask(t);
        if (isOverdue || isDueToday || isCritical) categorized.mustDo.push(formatted);
        else if (isInProgress) categorized.inProgress.push(formatted);
        else categorized.optional.push(formatted);
      }

      // Capacity budget
      const [startH, startM] = body.startTime.split(':').map(Number);
      const [endH, endM] = body.endTime.split(':').map(Number);
      const totalWindowMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      const appointmentMinutes = existingAppointments.reduce((sum: number, a: any) => {
        const [aStartH, aStartM] = a.start.split(':').map(Number);
        const [aEndH, aEndM] = a.end.split(':').map(Number);
        return sum + ((aEndH * 60 + aEndM) - (aStartH * 60 + aStartM));
      }, 0);
      const maxWorkMinutes = totalWindowMinutes - appointmentMinutes;

      const scheduled = { mustDo: [] as any[], goals: [] as any[], inProgress: [] as any[], optional: [] as any[] };
      const preDeferred: { title: string; reason: string }[] = [];
      let usedMinutes = 0;

      function fillCategory(source: any[], key: keyof typeof scheduled) {
        for (const task of source) {
          if (usedMinutes + task.estimated_minutes <= maxWorkMinutes) {
            usedMinutes += task.estimated_minutes;
            scheduled[key].push(task);
          } else {
            preDeferred.push({ title: task.title, reason: 'not enough time in the day' });
          }
        }
      }

      for (const task of categorized.mustDo) {
        usedMinutes += task.estimated_minutes;
        scheduled.mustDo.push(task);
      }
      fillCategory(categorized.goals, 'goals');
      fillCategory(categorized.inProgress, 'inProgress');
      for (const task of categorized.optional) {
        preDeferred.push({ title: task.title, reason: 'not selected as a goal for today' });
      }

      const totalScheduled = scheduled.mustDo.length + scheduled.goals.length + scheduled.inProgress.length;

      // Emit prefilter event — client gets instant feedback
      sendEvent('prefilter', {
        totalScheduled,
        deferred: preDeferred.length,
        breakdown: {
          mustDo: scheduled.mustDo.length,
          goals: scheduled.goals.length,
          inProgress: scheduled.inProgress.length,
        },
        capacityMinutes: maxWorkMinutes,
        usedMinutes,
      });

      if (totalScheduled === 0) {
        sendEvent('done', { plan: [], deferred: preDeferred, taskCount: preDeferred.length, message: 'No tasks to schedule' });
        clearTimeout(routeTimer);
        reply.raw.end();
        return;
      }

      // Compact JSON in prompt — saves ~25% tokens vs pretty-printed
      const userPrompt = `User availability:
* Start: ${body.startTime}
* End: ${body.endTime} (HARD DEADLINE — prefer ending early)
* Available work time: ${maxWorkMinutes} minutes

Energy: ${body.energyLevel}
Focus block preference: ${body.focusBlockMinutes} min

Fixed events (DO NOT move or schedule over):
${existingAppointments.length > 0 ? JSON.stringify(existingAppointments) : 'None'}

Tasks to schedule (total effort: ${usedMinutes} min):

mustDo (overdue/due today/critical): ${scheduled.mustDo.length > 0 ? JSON.stringify(scheduled.mustDo) : 'None'}
goals (user priorities): ${scheduled.goals.length > 0 ? JSON.stringify(scheduled.goals) : 'None'}
inProgress: ${scheduled.inProgress.length > 0 ? JSON.stringify(scheduled.inProgress) : 'None'}

Today: ${today}. You have EXACTLY ${totalScheduled} tasks. Place ALL of them. End BEFORE ${body.endTime}.`;

      // Stream OpenAI response, accumulating content
      let content = '';
      let tokenCount = 0;
      const streamMeta: StreamMeta = { finishReason: null };
      const streamStart = Date.now();
      try {
        for await (const delta of streamOpenAI(
          env.OPENAI_API_KEY,
          env.OPENAI_MODEL_TEXT,
          [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          streamMeta,
        )) {
          content += delta;
          tokenCount += 1;
          // Emit a token-progress event every few deltas (not every one — noise)
          if (tokenCount % 5 === 0) {
            sendEvent('token', { count: tokenCount });
          }
        }
      } catch (err: any) {
        app.log.error({
          err: err.message,
          model: env.OPENAI_MODEL_TEXT,
          contentLen: content.length,
          streamMs: Date.now() - streamStart,
        }, 'OpenAI stream failed');
        sendEvent('error', { message: 'AI call failed — please try again' });
        clearTimeout(routeTimer);
        reply.raw.end();
        return;
      }

      app.log.info({
        model: env.OPENAI_MODEL_TEXT,
        contentLen: content.length,
        chunks: tokenCount,
        finishReason: streamMeta.finishReason,
        streamMs: Date.now() - streamStart,
      }, 'OpenAI stream complete');

      if (!content.trim()) {
        app.log.error({ finishReason: streamMeta.finishReason }, 'OpenAI returned empty content');
        sendEvent('error', {
          message: streamMeta.finishReason === 'length'
            ? 'AI response was cut off (token limit). Try fewer tasks or a single workspace.'
            : 'AI returned an empty response. Please try again.',
        });
        clearTimeout(routeTimer);
        reply.raw.end();
        return;
      }

      // Parse final JSON — robust against code fences, leading prose, and partial payloads
      let parsed: any;
      const candidate = extractJsonCandidate(content);
      try {
        parsed = JSON.parse(candidate);
      } catch (parseErr: any) {
        app.log.error({
          err: parseErr.message,
          finishReason: streamMeta.finishReason,
          contentLen: content.length,
          candidateLen: candidate.length,
          contentHead: content.slice(0, 300),
          contentTail: content.slice(-300),
        }, 'AI JSON parse failed');
        sendEvent('error', {
          message: streamMeta.finishReason === 'length'
            ? 'AI response was cut off before completing. Try fewer tasks.'
            : 'AI returned invalid format — please try again.',
        });
        clearTimeout(routeTimer);
        reply.raw.end();
        return;
      }

      if (!parsed.plan || !Array.isArray(parsed.plan)) {
        app.log.error({
          parsedKeys: Object.keys(parsed || {}),
          contentHead: content.slice(0, 300),
        }, 'AI returned JSON without valid plan array');
        sendEvent('error', { message: 'AI returned invalid plan format' });
        clearTimeout(routeTimer);
        reply.raw.end();
        return;
      }

      const aiDeferred = (parsed.deferred || []).map((d: any) =>
        typeof d === 'string' ? { title: d, reason: '' } : { title: d.title || d, reason: d.reason || '' }
      );
      const allDeferred = [...preDeferred, ...aiDeferred];
      const taskCount = totalScheduled + preDeferred.length;

      sendEvent('done', {
        plan: parsed.plan,
        deferred: allDeferred,
        taskCount,
      });
      clearTimeout(routeTimer);
      reply.raw.end();
    } catch (err: any) {
      app.log.error({ err: err.message, stack: err.stack }, 'generate-plan/stream error');
      sendEvent('error', { message: err.message || 'Plan generation failed' });
      clearTimeout(routeTimer);
      try { reply.raw.end(); } catch { /* noop */ }
    }
  });
}
