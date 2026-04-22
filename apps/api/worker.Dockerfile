FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY packages/shared/package*.json packages/shared/
RUN npm install

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY . .
CMD ["npx", "tsx", "apps/api/src/worker.ts"]
