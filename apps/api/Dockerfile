FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY packages/shared/package*.json packages/shared/
RUN npm install
COPY . .
EXPOSE 4000
CMD ["npm", "--workspace", "apps/api", "run", "dev"]
