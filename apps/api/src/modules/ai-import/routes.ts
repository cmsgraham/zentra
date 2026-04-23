import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { assertAllowedImage } from '../../lib/file-validation.js';
import { v4 as uuidv4 } from 'uuid';

const textImportSchema = z.object({
  text: z.string().min(1).max(12000),
});

const acceptItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
  workspaceId: z.string().uuid().optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

async function checkMembership(app: FastifyInstance, workspaceId: string, userId: string) {
  const result = await app.pg.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  if (result.rows.length === 0) throw new ForbiddenError();
}

export default async function aiImportRoutes(app: FastifyInstance) {
  // Create text import job
  app.post('/workspaces/:workspaceId/ai/import-text', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = textImportSchema.parse(request.body);
    const userId = request.user.sub;
    await checkMembership(app, workspaceId, userId);

    const result = await app.pg.query(
      `INSERT INTO ai_import_jobs (workspace_id, created_by, input_type, source_text, status)
       VALUES ($1, $2, 'text', $3, 'queued') RETURNING id, workspace_id, input_type, status, created_at`,
      [workspaceId, userId, body.text],
    );
    const job = result.rows[0];

    // Enqueue for processing
    await app.redis.lPush('queue:ai_import_text', JSON.stringify({
      jobId: job.id,
      workspaceId,
      userId,
    }));

    return reply.status(202).send({
      id: job.id,
      workspaceId: job.workspace_id,
      inputType: job.input_type,
      status: job.status,
      createdAt: job.created_at,
    });
  });

  // Create image import job
  app.post('/workspaces/:workspaceId/ai/import-image', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const userId = request.user.sub;
    await checkMembership(app, workspaceId, userId);

    const file = await request.file();
    if (!file) {
      throw new BadRequestError('Image file is required');
    }

    const buffer = await file.toBuffer();
    await assertAllowedImage(buffer, file.mimetype);

    // Upload to S3
    const key = `imports/${workspaceId}/${uuidv4()}-${file.filename}`;
    const fileUrl = await app.uploadFile(key, buffer, file.mimetype);

    const result = await app.pg.query(
      `INSERT INTO ai_import_jobs (workspace_id, created_by, input_type, source_file_url, status)
       VALUES ($1, $2, 'image', $3, 'queued') RETURNING id, workspace_id, input_type, status, created_at`,
      [workspaceId, userId, fileUrl],
    );
    const job = result.rows[0];

    // Enqueue for processing
    await app.redis.lPush('queue:ai_import_image', JSON.stringify({
      jobId: job.id,
      workspaceId,
      userId,
      fileUrl,
    }));

    return reply.status(202).send({
      id: job.id,
      workspaceId: job.workspace_id,
      inputType: job.input_type,
      status: job.status,
      createdAt: job.created_at,
    });
  });

  // Get import job details
  app.get('/ai/import-jobs/:jobId', { preHandler: [app.authenticate] }, async (request) => {
    const { jobId } = request.params as { jobId: string };

    const jobResult = await app.pg.query(
      'SELECT * FROM ai_import_jobs WHERE id = $1',
      [jobId],
    );
    if (jobResult.rows.length === 0) throw new NotFoundError('Import job not found');
    const job = jobResult.rows[0];

    await checkMembership(app, job.workspace_id, request.user.sub);

    const itemsResult = await app.pg.query(
      `SELECT id, original_text_snippet, proposed_title, proposed_description, proposed_status,
              proposed_priority, proposed_due_date, proposed_assignee_id, confidence_score,
              ambiguity_flags_json, accepted, created_task_id
       FROM ai_import_items WHERE job_id = $1 ORDER BY created_at`,
      [jobId],
    );

    return {
      id: job.id,
      workspaceId: job.workspace_id,
      inputType: job.input_type,
      status: job.status,
      createdAt: job.created_at,
      items: itemsResult.rows.map(r => ({
        id: r.id,
        originalTextSnippet: r.original_text_snippet,
        proposedTitle: r.proposed_title,
        proposedDescription: r.proposed_description,
        proposedStatus: r.proposed_status,
        proposedPriority: r.proposed_priority,
        proposedDueDate: r.proposed_due_date,
        proposedAssigneeId: r.proposed_assignee_id,
        confidenceScore: parseFloat(r.confidence_score),
        ambiguityFlags: r.ambiguity_flags_json,
      })),
    };
  });

  // Accept import items
  app.post('/ai/import-jobs/:jobId/accept', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const body = acceptItemsSchema.parse(request.body);
    const userId = request.user.sub;

    const jobResult = await app.pg.query(
      'SELECT workspace_id, status FROM ai_import_jobs WHERE id = $1',
      [jobId],
    );
    if (jobResult.rows.length === 0) throw new NotFoundError('Import job not found');
    const job = jobResult.rows[0];

    if (job.status !== 'completed') {
      throw new BadRequestError('Job is not yet completed');
    }

    await checkMembership(app, job.workspace_id, userId);

    // Allow overriding target workspace
    const targetWorkspaceId = body.workspaceId || job.workspace_id;
    if (body.workspaceId) {
      await checkMembership(app, body.workspaceId, userId);
    }

    const items = await app.pg.query(
      `SELECT * FROM ai_import_items WHERE job_id = $1 AND id = ANY($2) AND accepted IS NULL`,
      [jobId, body.itemIds],
    );

    const createdTasks = [];
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      for (const item of items.rows) {
        const taskResult = await client.query(
          `INSERT INTO tasks (workspace_id, title, description, status, priority, blocked_reason,
            assignee_id, creator_id, due_date, source_type, source_reference_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ai_import', $10)
           RETURNING *`,
          [targetWorkspaceId, item.proposed_title, item.proposed_description,
           item.proposed_status, item.proposed_priority, null,
           item.proposed_assignee_id, userId, item.proposed_due_date, jobId],
        );
        const task = taskResult.rows[0];
        createdTasks.push({
          id: task.id,
          workspaceId: task.workspace_id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          createdAt: task.created_at,
        });

        await client.query(
          'UPDATE ai_import_items SET accepted = true, created_task_id = $1 WHERE id = $2',
          [task.id, item.id],
        );

        // Log activity
        await client.query(
          `INSERT INTO task_activity (task_id, actor_id, action_type, after_json)
           VALUES ($1, $2, 'created_from_import', $3)`,
          [task.id, userId, JSON.stringify({ importJobId: jobId, title: task.title })],
        );

        // Enqueue embedding
        await app.redis.lPush('queue:generate_task_embeddings', JSON.stringify({ taskId: task.id }));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return reply.status(201).send({ items: createdTasks });
  });
}
