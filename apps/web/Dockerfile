FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json apps/web/
COPY packages/shared/package*.json packages/shared/
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "--workspace", "apps/web", "run", "dev"]
