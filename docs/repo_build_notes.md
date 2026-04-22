# Repo Build Notes

## Frontend
Use Next.js App Router.
Preferred pages/routes:
- /login
- /signup
- /workspaces
- /workspaces/[workspaceId]
- /workspaces/[workspaceId]/blocked
- /workspaces/[workspaceId]/archive
- /import/text
- /import/image

## Backend
Recommended modules:
- auth
- users
- workspaces
- invites
- tasks
- comments
- activity
- ai-import
- ai-suggestions
- embeddings

## Queue jobs
- ai_import_text
- ai_import_image
- generate_task_embeddings
- improve_task

## MVP notes
- Do not add shopping lists yet
- Do not add external integrations yet
- Expose lane ordering in task APIs
- Add pagination to list endpoints
- Plan rate limiting for AI endpoints from day one
- Build web, API, and worker to run in containers
- Avoid local-disk assumptions for uploaded files


## Additional decisions
- Max image upload size: 10 MB in MVP
- Workspace member list endpoint is required for assignee pickers
- Tag list/create endpoints are required for task editing flows
- Keep JWT expiration and refresh strategy explicit in auth implementation
- Standardize one embedding dimension for MVP to avoid schema fragmentation


## Additional implementation notes
- Tag creation policy: do not auto-create tags during task create/update in MVP unless explicitly enabled
- Logout should revoke refresh tokens server-side
- Worker container should get a real entrypoint as soon as queue processing is implemented
- Production images should use dedicated production Dockerfiles, not dev volume mounts
- Post-MVP embedding model changes require a migration strategy, not an in-place dimension flip
