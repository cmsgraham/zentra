import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(8),
  JWT_ISSUER: z.string().default('zentra'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL_TEXT: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_VISION: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  S3_ENDPOINT: z.string().default('http://minio:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('zentra-uploads'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z.string().default('true'),
  REDIS_URL: z.string().default('redis://redis:6379'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}
