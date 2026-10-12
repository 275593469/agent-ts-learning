# 第 8 周：全栈项目交付

## 学习内容
前后端联调、任务执行进度、SSE 推送、持久化、容器部署、监控与成本分析。

## 文件说明

| 文件 | 知识点 |
| --- | --- |
| `task-progress.ts` | 任务状态模型 + 事件订阅（支持历史回放） |
| `sse.ts` | SSE 工具：流式对话推送、任务进度推送、连接数打点 |
| `middleware.ts` | 鉴权（Bearer + SSE 的 `?token=`）、按 IP 限流、请求日志、统一错误处理 |
| `metrics.ts` | 指标注册表：请求量、错误率、P50/P95 延迟、SSE 连接数、任务数 |
| `server.ts` | Express 服务：中间件 + 静态托管 + 对话/任务/指标接口 |

前端演示页在项目根目录 `public/index.html`（流式对话 + 任务进度 + 指标面板）。

## 运行

```bash
npm run dev            # http://localhost:3000
```

浏览器打开首页即可看到内置演示页（流式对话 + 任务进度条）。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 演示页（`public/index.html`） |
| GET | `/api/health` | 健康检查（免鉴权） |
| GET | `/api/metrics` | 服务指标快照（请求量、错误率、P95、SSE 连接数） |
| POST | `/api/chat` | 同步对话（走第 3 周 Agent） |
| GET | `/api/chat/stream?question=` | SSE 流式对话 |
| POST | `/api/tasks` | 创建后台任务 |
| GET | `/api/tasks/:taskId/stream` | SSE 订阅任务进度 |

## 鉴权与限流

```bash
API_TOKEN=demo-api-token npm run dev     # 开启鉴权
```

- 普通接口：`Authorization: Bearer <token>`
- SSE 接口：`?token=<token>`（`EventSource` 无法自定义请求头；生产建议用短时效令牌或 Cookie）
- 限流：默认每 IP 每分钟 120 次，可用 `RATE_LIMIT_PER_MINUTE` 调整，超限返回 429 + `Retry-After`

## 部署

```bash
npm run build
npm start

# 容器化（多阶段构建，只安装生产依赖，非 root 运行，带 HEALTHCHECK）
docker build -t campus-agent:latest .
docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-xxx -e API_TOKEN=demo-api-token campus-agent:latest
```

注意：`public/` 是静态资源目录，运行时按 `process.cwd()/public` 查找，
因此容器内工作目录需要是项目根（Dockerfile 已处理好）。

## 本周成果
可以演示、测试和部署的完整业务 Agent 平台。
