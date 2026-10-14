# agent-ts-learning

8 周 LLM Agent 工程化实战：**TypeScript + LangChain v1 / LangGraph**，从大模型调用基础一路做到可部署的全栈 Agent 平台。

每个学习周一个独立目录，代码可直接运行，逐周递进。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 语言 / 运行时 | TypeScript（ESM）+ Node 20+，用 `tsx` 直接运行 |
| 模型接入 | `@langchain/openai`（兼容 OpenAI 协议的网关亦可） |
| Agent 编排 | `langchain` / `@langchain/core` / `@langchain/langgraph` |
| 工具生态 | MCP（`@modelcontextprotocol/sdk` + `@langchain/mcp-adapters`） |
| 服务端 | Express 5 + SSE |
| 参数校验 | Zod |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env   # 至少填入 OPENAI_API_KEY

# 3. 启动第 8 周完整 Agent 平台
npm run dev            # http://localhost:3000
```

打开根路径即可看到内置演示页：流式对话 + 任务进度条。

## 环境变量

在根目录 `.env` 中配置，所有周次的 demo 共用（见 `.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | 必填，模型 API Key |
| `OPENAI_MODEL` | 对话模型，如 `gpt-4o-mini` |
| `OPENAI_BASE_URL` | 可选，兼容 OpenAI 协议的自建网关 |
| `OPENAI_EMBEDDING_MODEL` | 第 4 周 RAG 向量模型 |
| `USE_LOCAL_EMBEDDING` | 网关不支持 embedding 时设为 `true`，使用本地哈希向量降级 |
| `PORT` | 服务端口，默认 `3000` |
| `API_TOKEN` | 第 8 周接口鉴权令牌，留空为开发模式（免鉴权） |
| `RATE_LIMIT_PER_MINUTE` | 第 8 周每 IP 每分钟请求上限，默认 `120` |
| `MCP_AUTH_TOKEN` | 第 6 周 MCP 写操作令牌，默认 `demo-token` |
| `MCP_HTTP_PORT` | 第 6 周 HTTP 传输 MCP Server 端口，默认 `3100` |
| `MCP_RESOURCE_TICK` | 设为 `1` 时天气 MCP Server 定时推送资源更新（演示订阅） |
| `EVAL_LIMIT` | 第 7 周回归评测只跑前 N 条用例，留空为全量 |

## 目录结构

```
.
├── src/
│   ├── week1-llm-basics/       大模型基础：Prompt 模式、参数、结构化输出、流式、异常、成本、缓存
│   ├── week2-tool-calling/     Tool Calling、工具路由、并行调用、容错重试、工具检索式选择
│   ├── week3-agent-loop/       Agent 循环、手写 ReAct、反思修订、规划执行、多 Agent 协作
│   ├── week4-rag/              切片策略、Embedding、BM25、混合检索、查询改写、重排、引用溯源
│   ├── week5-memory-workflow/  摘要记忆、长期记忆、持久化检查点、工作流编排、人工审批队列
│   ├── week6-mcp/              MCP Client / Server、多 Server 聚合、资源订阅、HTTP 传输
│   ├── week7-eval-security/    评测集与回归、注入防护测试、权限校验、成本守卫、轨迹报告
│   └── week8-fullstack/        Express + SSE 平台：中间件、指标、任务进度、静态前端
├── public/index.html           第 8 周演示页（流式对话 + 任务进度 + 指标面板）
├── Dockerfile / .dockerignore  容器化交付（多阶段构建 + 健康检查）
├── .env.example                环境变量模板
└── tsconfig.json
```

## 常用脚本

| 脚本 | 说明 |
| --- | --- |
| `npm run dev` | 第 8 周全栈平台（端口 3000） |
| `npm run dev:week1` | 第 1 周对话服务（端口 3001） |
| `npm run week1:hello` / `week1:stream` | 最小调用 / 流式输出 |
| `npm run week2:router` | 多工具路由与失败处理 |
| `npm run week3:report` | 自主取数并生成报告的 Agent |
| `npm run week4:rag` | RAG 检索问答 |
| `npm run week5:memory` / `week5:approval` | 会话记忆 / 人工审批 |
| `npm run week6:mcp` | MCP Client 调用 MCP Server |
| `npm run week7:eval` | 评估 + 安全 + 性能流水线 |
| `npm run week7:regression` | 评测回归对比（有回归则退出码 1，可接 CI） |
| `npm run week7:injection` / `week7:trace` | 注入防护测试 / 轨迹聚合报告（纯本地） |
| `npm run build` / `npm start` | 编译到 `dist/` / 运行编译产物 |

每周的进阶示例都有独立脚本，完整的脚本清单见 `package.json`，例如：

| 主题 | 脚本 |
| --- | --- |
| 提示词与成本 | `week1:patterns`、`week1:params`、`week1:cost`、`week1:cache` |
| 工具调用进阶 | `week2:parallel`、`week2:resilience`、`week2:tool-search` |
| Agent 进阶 | `week3:react`、`week3:reflection`、`week3:planner`、`week3:multi` |
| RAG 进阶 | `week4:chunking`、`week4:bm25`、`week4:rewrite`、`week4:rerank` |
| 记忆与工作流 | `week5:summary`、`week5:persist`、`week5:workflow`、`week5:approval-queue` |
| MCP 进阶 | `week6:mcp-multi`、`week6:mcp-resources`、`week6:mcp-http-server`、`week6:mcp-http-client` |
| 成本与安全 | `week7:cost`、`week7:injection`、`week7:trace`、`week7:regression` |

任意单个文件也可直接运行：

```bash
npx tsx src/week2-tool-calling/tool-calling.ts
```

## 第 8 周接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 演示页（`public/index.html`） |
| GET | `/api/health` | 健康检查（免鉴权） |
| GET | `/api/metrics` | 服务指标：请求量、错误率、P50/P95 延迟、SSE 连接数 |
| POST | `/api/chat` | 同步对话（走第 3 周 Agent） |
| GET | `/api/chat/stream?question=` | SSE 流式对话 |
| POST | `/api/tasks` | 创建后台任务 |
| GET | `/api/tasks/:taskId/stream` | SSE 订阅任务进度 |

鉴权与限流（可选开启）：

```bash
API_TOKEN=demo-api-token npm run dev
# 普通接口：Authorization: Bearer demo-api-token
# SSE 接口：/api/chat/stream?question=...&token=demo-api-token
```

## 容器化

```bash
docker build -t campus-agent:latest .
docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-xxx campus-agent:latest
```

镜像使用多阶段构建（只装生产依赖）、非 root 运行，并带 `/api/health` 健康检查。

## 进一步阅读

- 学习路线、每周知识点与交付成果：`src/README.md`
- 各周详细说明：对应目录下的 `README.md`

## 说明

- 第 4 周未使用 `MemoryVectorStore`：`@langchain/core` v1 已移除该类，改为手写内存向量库以讲清检索与重排原理。
- 第 6 周依赖 `@modelcontextprotocol/sdk`、`@langchain/mcp-adapters`，已在 `package.json` 声明。

## 许可证

[MIT](./LICENSE) © 2026 chiangcheng
