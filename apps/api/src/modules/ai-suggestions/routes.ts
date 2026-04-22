import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { getAIProvider } from '../ai-import/provider.js';
import { DECOMPOSE_SYSTEM_PROMPT, CLARIFY_SYSTEM_PROMPT } from './prompts.js';

async function checkMembership(app: FastifyInstance, workspaceId: string, userId: string) {
  const result = await app.pg.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  if (result.rows.length === 0) throw new ForbiddenError();
}

export default async function aiSuggestionRoutes(app: FastifyInstance) {
  // Improve task
  app.post('/tasks/:taskId/ai/improve', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const userId = request.user.sub;

    const taskResult = await app.pg.query(
      `SELECT t.*, u.name as assignee_name FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1`,
      [taskId],
    );
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');
    const task = taskResult.rows[0];

    await checkMembership(app, task.workspace_id, userId);

    // Get similar tasks via embeddings
    let similarTasks: any[] = [];
    try {
      const embResult = await app.pg.query(
        'SELECT embedding FROM task_embeddings WHERE task_id = $1',
        [taskId],
      );
      if (embResult.rows.length > 0) {
        const similar = await app.pg.query(
          `SELECT te.task_id, t.title, t.status, t.priority, t.description
           FROM task_embeddings te
           JOIN tasks t ON t.id = te.task_id
           WHERE te.workspace_id = $1 AND te.task_id != $2 AND t.archived = false
           ORDER BY te.embedding <=> $3
           LIMIT 5`,
          [task.workspace_id, taskId, embResult.rows[0].embedding],
        );
        similarTasks = similar.rows.map(r => ({
          task_id: r.task_id,
          title: r.title,
          status: r.status,
          priority: r.priority,
        }));
      }
    } catch { /* embeddings may not exist yet */ }

    const provider = getAIProvider();
    const suggestion = await provider.improveTask(
      {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        blocked_reason: task.blocked_reason,
      },
      similarTasks,
    );

    return {
      suggestedTitle: suggestion.suggested_title,
      suggestedDescription: suggestion.suggested_description || null,
      suggestedPriority: suggestion.suggested_priority,
      rationale: suggestion.rationale,
      similarTaskIds: suggestion.similar_task_ids || [],
    };
  });

  // POST /ai/decompose — break a task into micro-steps (free tier: 10/month)
  app.post('/ai/decompose', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = request.user.sub;
    const body = z.object({
      taskId: z.string().uuid(),
    }).parse(request.body);

    const taskResult = await app.pg.query(
      `SELECT t.* FROM tasks t
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
       WHERE t.id = $1 AND wm.user_id = $2`,
      [body.taskId, userId],
    );
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');
    const task = taskResult.rows[0];

    // Free-tier quota: 10 decompositions per calendar month
    const userResult = await app.pg.query(
      'SELECT zentra_plus_until, zentra_ai_opt_in FROM users WHERE id = $1',
      [userId],
    );
    const user = userResult.rows[0];
    const isPlus = user?.zentra_plus_until && new Date(user.zentra_plus_until) > new Date();

    if (!isPlus) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const quotaResult = await app.pg.query(
        'SELECT count(*) FROM ai_decompositions WHERE user_id = $1 AND created_at >= $2',
        [userId, monthStart.toISOString()],
      );
      const used = parseInt(quotaResult.rows[0].count, 10);
      if (used >= 10) {
        return reply.status(402).send({ error: 'quota_exceeded', upgradeUrl: '/settings/plus' });
      }
    }

    const userMessage = `Task title: ${task.title}\nDescription: ${task.description || 'None'}`;
    const provider = getAIProvider();
    const raw = await provider.chat(DECOMPOSE_SYSTEM_PROMPT, userMessage);
    const parsed = JSON.parse(raw);

    // Persist decomposition
    const saved = await app.pg.query(
      `INSERT INTO ai_decompositions (user_id, task_id, input_text, micro_steps, model_used)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, body.taskId, userMessage, JSON.stringify(parsed.microSteps), 'gpt'],
    );

    return {
      decompositionId: saved.rows[0].id,
      microSteps: parsed.microSteps,
      entryPoint: parsed.entryPoint ?? null,
    };
  });

  // POST /ai/clarify — suggest a single next action for a task
  app.post('/ai/clarify', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    const userId = request.user.sub;
    const body = z.object({
      taskId: z.string().uuid(),
    }).parse(request.body);

    const taskResult = await app.pg.query(
      `SELECT t.* FROM tasks t
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
       WHERE t.id = $1 AND wm.user_id = $2`,
      [body.taskId, userId],
    );
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');
    const task = taskResult.rows[0];

    const userMessage = `Task title: ${task.title}\nDescription: ${task.description || 'None'}\nCurrent next action: ${task.next_action || 'None'}`;
    const provider = getAIProvider();
    const raw = await provider.chat(CLARIFY_SYSTEM_PROMPT, userMessage);
    const parsed = JSON.parse(raw);

    return { nextAction: parsed.nextAction };
  });
}
