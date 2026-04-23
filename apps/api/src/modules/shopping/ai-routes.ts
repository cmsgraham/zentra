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
  listId: z.string().uuid(),
});

async function checkListAccess(app: FastifyInstance, listId: string, userId: string) {
  const ownerCheck = await app.pg.query(
    'SELECT id FROM shopping_lists WHERE id = $1 AND owner_user_id = $2', [listId, userId],
  );
  if (ownerCheck.rows.length > 0) return;
  const memberCheck = await app.pg.query(
    'SELECT role FROM shopping_list_members WHERE list_id = $1 AND user_id = $2', [listId, userId],
  );
  if (memberCheck.rows.length === 0) throw new ForbiddenError();
}

export default async function shoppingAIRoutes(app: FastifyInstance) {
  // Text import for shopping items
  app.post('/shopping/ai/import-text', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = textImportSchema.parse(request.body);
    const userId = request.user.sub;

    const result = await app.pg.query(
      `INSERT INTO shopping_import_jobs (created_by, input_type, source_text, status)
       VALUES ($1, 'text', $2, 'queued') RETURNING id, input_type, status, created_at`,
      [userId, body.text],
    );
    const job = result.rows[0];

    await app.redis.lPush('queue:shopping_import_text', JSON.stringify({
      jobId: job.id,
      userId,
    }));

    return reply.status(202).send({
      id: job.id,
      inputType: job.input_type,
      status: job.status,
      createdAt: job.created_at,
    });
  });

  // Image import for shopping items
  app.post('/shopping/ai/import-image', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = request.user.sub;

    const file = await request.file();
    if (!file) throw new BadRequestError('Image file is required');

    const buffer = await file.toBuffer();
    await assertAllowedImage(buffer, file.mimetype);

    const key = `shopping-imports/${userId}/${uuidv4()}-${file.filename}`;
    const fileUrl = await app.uploadFile(key, buffer, file.mimetype);

    const result = await app.pg.query(
      `INSERT INTO shopping_import_jobs (created_by, input_type, source_file_url, status)
       VALUES ($1, 'image', $2, 'queued') RETURNING id, input_type, status, created_at`,
      [userId, fileUrl],
    );
    const job = result.rows[0];

    await app.redis.lPush('queue:shopping_import_image', JSON.stringify({
      jobId: job.id,
      userId,
      fileUrl,
    }));

    return reply.status(202).send({
      id: job.id,
      inputType: job.input_type,
      status: job.status,
      createdAt: job.created_at,
    });
  });

  // Get shopping import job details
  app.get('/shopping/ai/import-jobs/:jobId', { preHandler: [app.authenticate] }, async (request) => {
    const { jobId } = request.params as { jobId: string };

    const jobResult = await app.pg.query('SELECT * FROM shopping_import_jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) throw new NotFoundError();
    const job = jobResult.rows[0];

    const itemsResult = await app.pg.query(
      'SELECT * FROM shopping_import_items WHERE job_id = $1 ORDER BY proposed_name ASC',
      [jobId],
    );

    return {
      id: job.id,
      status: job.status,
      inputType: job.input_type,
      errorMessage: job.error_message,
      items: itemsResult.rows.map(r => ({
        id: r.id,
        proposedName: r.proposed_name,
        proposedQuantity: r.proposed_quantity ? parseFloat(r.proposed_quantity) : null,
        proposedUnit: r.proposed_unit,
        proposedCategory: r.proposed_category,
        confidenceScore: parseFloat(r.confidence_score),
        ambiguityFlags: r.ambiguity_flags,
        originalTextSnippet: r.original_text_snippet,
        accepted: r.accepted,
      })),
      createdAt: job.created_at,
    };
  });

  // Accept shopping import items → add them to a list
  app.post('/shopping/ai/import-jobs/:jobId/accept', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const body = acceptItemsSchema.parse(request.body);
    const userId = request.user.sub;

    // Verify job ownership
    const jobResult = await app.pg.query('SELECT * FROM shopping_import_jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) throw new NotFoundError();
    const job = jobResult.rows[0];
    if (job.created_by !== userId) throw new ForbiddenError();
    if (job.status !== 'completed') throw new BadRequestError('Job is not ready');

    // Verify list access
    await checkListAccess(app, body.listId, userId);

    // Get accepted draft items
    const drafts = await app.pg.query(
      'SELECT * FROM shopping_import_items WHERE job_id = $1 AND id = ANY($2)',
      [jobId, body.itemIds],
    );

    const maxSort = await app.pg.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM shopping_list_items WHERE list_id = $1',
      [body.listId],
    );
    let sortOrder = maxSort.rows[0].max_sort + 1;

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');

      for (const draft of drafts.rows) {
        const normalized = draft.proposed_name.trim().toLowerCase().replace(/\s+/g, ' ');

        // Upsert item memory
        const memResult = await client.query(
          `INSERT INTO shopping_item_memory (user_id, normalized_name, preferred_display_name, default_category, default_unit, total_added_count, last_added_at)
           VALUES ($1, $2, $3, $4, $5, 1, now())
           ON CONFLICT (user_id, normalized_name) DO UPDATE SET
             total_added_count = shopping_item_memory.total_added_count + 1,
             last_added_at = now()
           RETURNING id`,
          [userId, normalized, draft.proposed_name, draft.proposed_category, draft.proposed_unit],
        );

        await client.query(
          `INSERT INTO shopping_list_items (list_id, item_memory_id, display_name, normalized_name, quantity, unit, category, created_by_user_id, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [body.listId, memResult.rows[0].id, draft.proposed_name, normalized, draft.proposed_quantity, draft.proposed_unit, draft.proposed_category, userId, sortOrder++],
        );

        await client.query(
          'UPDATE shopping_import_items SET accepted = true WHERE id = $1', [draft.id],
        );
      }

      // Mark unaccepted
      await client.query(
        'UPDATE shopping_import_items SET accepted = false WHERE job_id = $1 AND id != ALL($2)',
        [jobId, body.itemIds],
      );

      await client.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [body.listId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { ok: true, accepted: drafts.rows.length };
  });
}
