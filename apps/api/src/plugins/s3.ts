import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getEnv } from '../lib/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    s3: S3Client;
    s3Bucket: string;
    uploadFile: (key: string, body: Buffer, contentType: string) => Promise<string>;
  }
}

export default fp(async (app: FastifyInstance) => {
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

  app.decorate('s3', s3);
  app.decorate('s3Bucket', env.S3_BUCKET);

  app.decorate('uploadFile', async (key: string, body: Buffer, contentType: string) => {
    await s3.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;
  });
});
