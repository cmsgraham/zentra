# Backend Service Contracts

## AuthService
- signUp(input)
- login(input)
- logout(sessionOrToken)  # revokes refresh token server-side
- requestPasswordReset(email)
- confirmPasswordReset(token, newPassword)
- issueAccessToken(user, expiresIn)
- issueRefreshToken(user, expiresIn)
- refreshAccessToken(refreshToken)
- verifyToken(token)

## WorkspaceService
- createWorkspace(input)
- inviteMember(input)
- acceptInvite(token, userId)
- listUserWorkspaces(userId, pagination)
- listWorkspaceMembers(workspaceId, pagination)

## TagService
- listTags(workspaceId, pagination)
- createTag(workspaceId, input)
- deleteTag(workspaceId, tagId)

## TaskService
- createTask(input)
- updateTask(taskId, input)
- moveTask(taskId, input)
- listTasks(filters, pagination)
- archiveTask(taskId)
- listActivity(taskId, pagination)

## CommentService
- createComment(input)
- listComments(taskId, pagination)

## AIImportService
- createTextImportJob(input)
- createImageImportJob(input)
- getImportJob(jobId)
- acceptImportItems(jobId, itemIds)

## AISuggestionService
- improveTask(taskId)
- findSimilarTasks(taskId)
- generateWorkspaceInsights(workspaceId)
