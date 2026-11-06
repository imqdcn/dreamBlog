# Strapi 生产镜像
FROM node:20-bookworm-slim AS build
WORKDIR /app

# 构建原生依赖（better-sqlite3 / sharp 等）所需
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./
EXPOSE 1337
CMD ["npm", "run", "start"]
