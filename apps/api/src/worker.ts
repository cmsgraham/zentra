import pg from 'pg';
import { createClient, type RedisClientType } from 'redis';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getEnv } from './lib/env.js';
import { getAIProvider } from './modules/ai-import/provider.js';
import { extractShoppingItemsFromText, extractShoppingItemsFromImage } from './modules/shopping/ai-provider.js';
import { logger } from './lib/logger.js';

const env = getEnv();

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const redis = createClient({ url: env.REDIS_URL }) as RedisClientType;

async function processTextImport(message: string) {
  const { jobId, workspaceId, userId } = JSON.parse(message);
  logger.info({ jobId }, 'Processing text import job');

  try {
    await pool.query("UPDATE ai_import_jobs SET status = 'processing' WHERE id = $1", [jobId]);

    const jobResult = await pool.query('SELECT source_text FROM ai_import_jobs WHERE id = $1', [jobId]);
    const sourceText = jobResult.rows[0].source_text;

    // Gather context
    const membersResult = await pool.query(
      `SELECT u.id, u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1`,
      [workspaceId],
    );
    const tagsResult = await pool.query('SELECT name FROM task_tags WHERE workspace_id = $1', [workspaceId]);
    const wsResult = await pool.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);

    const provider = getAIProvider();
    const result = await provider.generateTaskDrafts(sourceText, {
      workspaceName: wsResult.rows[0]?.name,
      knownUsers: membersResult.rows,
      knownTags: tagsResult.rows.map(r => r.name),
      similarTasks: [],
    });

    // Store draft items
    for (const item of result.items) {
      await pool.query(
        `INSERT INTO ai_import_items (job_id, original_text_snippet, proposed_title, proposed_description,
          proposed_status, proposed_priority, proposed_due_date, proposed_assignee_id, confidence_score, ambiguity_flags_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          jobId,
          item.original_text_snippet || item.title,
          item.title || item.proposed_title || 'Untitled',
          item.description || item.proposed_description || null,
          item.suggested_status || item.proposed_status || 'pending',
          item.suggested_priority || item.proposed_priority || 'medium',
          item.suggested_due_date || item.proposed_due_date || null,
          item.suggested_assignee_id || item.proposed_assignee_id || null,
          item.confidence_score ?? 0.5,
          JSON.stringify(item.ambiguity_flags || []),
        ],
      );
    }

    await pool.query(
      "UPDATE ai_import_jobs SET status = 'completed', raw_model_response_json = $1 WHERE id = $2",
      [JSON.stringify(result), jobId],
    );
    logger.info({ jobId, itemCount: result.items.length }, 'Text import completed');
  } catch (err) {
    logger.error({ jobId, err }, 'Text import failed');
    await pool.query(
      "UPDATE ai_import_jobs SET status = 'failed', failure_reason = $1 WHERE id = $2",
      [(err as Error).message, jobId],
    );
  }
}

async function processImageImport(message: string) {
  const { jobId, workspaceId, userId, fileUrl } = JSON.parse(message);
  logger.info({ jobId }, 'Processing image import job');

  try {
    await pool.query("UPDATE ai_import_jobs SET status = 'processing' WHERE id = $1", [jobId]);

    // Extract the S3 key from the fileUrl (format: http://minio:9000/bucket/key)
    const url = new URL(fileUrl);
    const pathParts = url.pathname.split('/').filter(Boolean); // ['bucket', ...keyParts]
    const s3Key = pathParts.slice(1).join('/'); // strip bucket name

    // Download image from S3 and convert to base64 data URI
    const getCmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key });
    const s3Response = await s3.send(getCmd);
    const imageBytes = await s3Response.Body!.transformToByteArray();
    const contentType = s3Response.ContentType || 'image/jpeg';
    const base64 = Buffer.from(imageBytes).toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;

    logger.info({ jobId, s3Key, contentType, sizeKB: Math.round(imageBytes.length / 1024) }, 'Downloaded image from S3');

    const membersResult = await pool.query(
      `SELECT u.id, u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1`,
      [workspaceId],
    );
    const wsResult = await pool.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);

    const provider = getAIProvider();
    const result = await provider.generateTaskDraftsFromImage(dataUri, {
      workspaceName: wsResult.rows[0]?.name,
      knownUsers: membersResult.rows,
    });

    for (const item of result.items) {
      await pool.query(
        `INSERT INTO ai_import_items (job_id, original_text_snippet, proposed_title, proposed_description,
          proposed_status, proposed_priority, proposed_due_date, proposed_assignee_id, confidence_score, ambiguity_flags_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          jobId,
          item.original_text_snippet || item.title,
          item.title || item.proposed_title || 'Untitled',
          item.description || item.proposed_description || null,
          item.suggested_status || item.proposed_status || 'pending',
          item.suggested_priority || item.proposed_priority || 'medium',
          item.suggested_due_date || item.proposed_due_date || null,
          item.suggested_assignee_id || item.proposed_assignee_id || null,
          item.confidence_score ?? 0.5,
          JSON.stringify(item.ambiguity_flags || []),
        ],
      );
    }

    await pool.query(
      "UPDATE ai_import_jobs SET status = 'completed', raw_model_response_json = $1 WHERE id = $2",
      [JSON.stringify(result), jobId],
    );
    logger.info({ jobId, itemCount: result.items.length }, 'Image import completed');
  } catch (err) {
    logger.error({ jobId, err }, 'Image import failed');
    await pool.query(
      "UPDATE ai_import_jobs SET status = 'failed', failure_reason = $1 WHERE id = $2",
      [(err as Error).message, jobId],
    );
  }
}

async function processEmbedding(message: string) {
  const { taskId } = JSON.parse(message);
  logger.info({ taskId }, 'Generating embedding');

  try {
    const taskResult = await pool.query(
      'SELECT id, workspace_id, title, description FROM tasks WHERE id = $1',
      [taskId],
    );
    if (taskResult.rows.length === 0) return;
    const task = taskResult.rows[0];

    const contentText = [task.title, task.description].filter(Boolean).join(' ');

    const provider = getAIProvider();
    const embeddings = await provider.generateEmbeddings([contentText]);
    const embedding = embeddings[0];

    const embeddingStr = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO task_embeddings (workspace_id, task_id, embedding_model, embedding_dimensions, content_text, embedding)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (task_id) DO UPDATE SET
         embedding_model = EXCLUDED.embedding_model,
         embedding_dimensions = EXCLUDED.embedding_dimensions,
         content_text = EXCLUDED.content_text,
         embedding = EXCLUDED.embedding`,
      [task.workspace_id, taskId, env.OPENAI_EMBEDDING_MODEL, 1536, contentText, embeddingStr],
    );

    logger.info({ taskId }, 'Embedding generated');
  } catch (err) {
    logger.error({ taskId, err }, 'Embedding generation failed');
  }
}

interface QueueProcessor {
  queue: string;
  handler: (message: string) => Promise<void>;
}

async function processShoppingTextImport(message: string) {
  const { jobId, userId } = JSON.parse(message);
  logger.info({ jobId }, 'Processing shopping text import');

  try {
    await pool.query("UPDATE shopping_import_jobs SET status = 'processing' WHERE id = $1", [jobId]);

    const jobResult = await pool.query('SELECT source_text FROM shopping_import_jobs WHERE id = $1', [jobId]);
    const sourceText = jobResult.rows[0].source_text;

    const result = await extractShoppingItemsFromText(sourceText);

    for (const item of result.items) {
      await pool.query(
        `INSERT INTO shopping_import_items (job_id, proposed_name, proposed_quantity, proposed_unit, proposed_category, confidence_score, ambiguity_flags, original_text_snippet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          jobId,
          item.name || 'Unknown Item',
          item.quantity || null,
          item.unit || null,
          item.category || null,
          item.confidence_score ?? 0.5,
          item.ambiguity_flags || [],
          item.original_text_snippet || item.name,
        ],
      );
    }

    await pool.query(
      "UPDATE shopping_import_jobs SET status = 'completed', result = $1 WHERE id = $2",
      [JSON.stringify(result), jobId],
    );
    logger.info({ jobId, itemCount: result.items.length }, 'Shopping text import completed');
  } catch (err) {
    logger.error({ jobId, err }, 'Shopping text import failed');
    await pool.query(
      "UPDATE shopping_import_jobs SET status = 'failed', error_message = $1 WHERE id = $2",
      [(err as Error).message, jobId],
    );
  }
}

async function processShoppingImageImport(message: string) {
  const { jobId, userId, fileUrl } = JSON.parse(message);
  logger.info({ jobId }, 'Processing shopping image import');

  try {
    await pool.query("UPDATE shopping_import_jobs SET status = 'processing' WHERE id = $1", [jobId]);

    // Download from S3 and convert to base64
    const url = new URL(fileUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const s3Key = pathParts.slice(1).join('/');

    const getCmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key });
    const s3Response = await s3.send(getCmd);
    const imageBytes = await s3Response.Body!.transformToByteArray();
    const contentType = s3Response.ContentType || 'image/jpeg';
    const base64 = Buffer.from(imageBytes).toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;

    const result = await extractShoppingItemsFromImage(dataUri);

    for (const item of result.items) {
      await pool.query(
        `INSERT INTO shopping_import_items (job_id, proposed_name, proposed_quantity, proposed_unit, proposed_category, confidence_score, ambiguity_flags, original_text_snippet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          jobId,
          item.name || 'Unknown Item',
          item.quantity || null,
          item.unit || null,
          item.category || null,
          item.confidence_score ?? 0.5,
          item.ambiguity_flags || [],
          item.original_text_snippet || item.name,
        ],
      );
    }

    await pool.query(
      "UPDATE shopping_import_jobs SET status = 'completed', result = $1 WHERE id = $2",
      [JSON.stringify(result), jobId],
    );
    logger.info({ jobId, itemCount: result.items.length }, 'Shopping image import completed');
  } catch (err) {
    logger.error({ jobId, err }, 'Shopping image import failed');
    await pool.query(
      "UPDATE shopping_import_jobs SET status = 'failed', error_message = $1 WHERE id = $2",
      [(err as Error).message, jobId],
    );
  }
}

const processors: QueueProcessor[] = [
  { queue: 'queue:ai_import_text', handler: processTextImport },
  { queue: 'queue:ai_import_image', handler: processImageImport },
  { queue: 'queue:generate_task_embeddings', handler: processEmbedding },
  { queue: 'queue:shopping_import_text', handler: processShoppingTextImport },
  { queue: 'queue:shopping_import_image', handler: processShoppingImageImport },
];

async function pollQueues() {
  for (const processor of processors) {
    try {
      const message = await redis.rPop(processor.queue);
      if (message) {
        await processor.handler(message);
      }
    } catch (err) {
      logger.error({ queue: processor.queue, err }, 'Queue processing error');
    }
  }
}

async function main() {
  await redis.connect();
  logger.info('Zentra worker started');
  logger.info(`Watching queues: ${processors.map(p => p.queue).join(', ')}`);

  // Poll loop
  while (true) {
    await pollQueues();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch(err => {
  logger.error({ err }, 'Worker crashed');
  process.exit(1);
});
