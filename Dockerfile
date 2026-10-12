# 学习目标：Agent 服务的容器化交付
# 分两阶段构建：builder 装全量依赖并编译 TS，runner 只保留运行时依赖与产物，
# 这样镜像体积更小、攻击面更窄。
#
# 构建：docker build -t campus-agent:latest .
# 运行：docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-xxx campus-agent:latest

# ---------- 1. 构建阶段 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 先拷贝依赖清单，利用 Docker 层缓存：源码变动不会导致重新装依赖
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- 2. 运行阶段 ----------
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# 只安装生产依赖，跳过 devDependencies
RUN npm ci --omit=dev && npm cache clean --force

# 编译产物 + 静态资源
COPY --from=builder /app/dist ./dist
COPY public ./public

# 以非 root 用户运行
USER node

EXPOSE 3000

# 健康检查：交给编排平台判断实例是否可用
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/week8-fullstack/server.js"]
