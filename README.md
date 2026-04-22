# Inkflow Repo Scaffold

Monorepo scaffold for Inkflow, a notebook-inspired collaborative task tracker with AI-assisted task extraction.

## Suggested stack
- apps/web: Next.js + TypeScript
- apps/api: Node.js + TypeScript + Fastify
- db: PostgreSQL + pgvector
- ai: prompt contracts and orchestration notes
- infra: Docker Compose and environment templates

## Core requirement
This app must run in containers. Treat containerized execution as a first-class requirement for local development and deployment.

## Monorepo layout
- `apps/web` — frontend app
- `apps/api` — backend API
- `packages/shared` — shared types and utilities
- `db/migrations` — SQL migrations
- `infra` — local infrastructure setup
- `docs` — build guidance and screen map
- `ai` — prompt packs and AI contracts

## Adjustments applied
- Picked npm workspaces and removed pnpm conflict
- Added MinIO recommendation for local image/object storage
- Kept repo focused on MVP scope
- AI endpoints should be rate-limited more strictly than CRUD endpoints
- Containerized local development is required

## Recommended build order
1. Bring up Postgres, Redis, and MinIO with Docker Compose
2. Add Dockerfiles for web, API, and worker
3. Implement auth and workspace flows in API
4. Implement task CRUD and board UI
5. Add comments and activity log
6. Add AI text import
7. Add AI image import
8. Add task improvement suggestions


## Production Dockerfiles
Use `apps/web/Dockerfile.prod` and `apps/api/Dockerfile.prod` for production image builds. The compose setup is for local dev; production should not rely on volume mounts.
