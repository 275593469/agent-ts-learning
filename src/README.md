# LLM Agent 开发 8 周实战（TypeScript）

> 8 周从大模型调用基础走到可部署的全栈 Agent 平台。
> 技术栈：TypeScript · LangChain v1 · LangGraph · OpenAI · Express · Zod

代码按学习周次分目录，每周一个可独立运行的 demo 集合，逐周递进、可单独运行。

## 目录结构

```
src/
├── week1-llm-basics/       第 1 周 大模型应用基础（7 + 5 个示例）
├── week2-tool-calling/     第 2 周 工具调用与函数编排（3 + 3 个示例）
├── week3-agent-loop/       第 3 周 Agent 循环与任务规划（3 + 4 个示例）
├── week4-rag/              第 4 周 RAG 知识库（6 + 4 个示例）
├── week5-memory-workflow/  第 5 周 记忆与工作流（3 + 4 个示例）
├── week6-mcp/              第 6 周 MCP 与工具生态（2 + 5 个示例）
├── week7-eval-security/    第 7 周 评估、安全与性能（6 + 5 个示例）
└── week8-fullstack/        第 8 周 全栈项目交付（4 个模块 + public/ 前端页）
```

每个目录入口文件少而清晰，进阶示例覆盖「概念 → 对比 → 工程实践」三段：
先跑通最小闭环，再看多方案对比输出，最后看生产上需要补的容错、观测与安全。

## 学习路线与代码目录

| 周次 | 阶段 | 学习内容 | 代码目录 |
| --- | --- | --- | --- |
| 第 1 周 | 大模型应用基础 | 模型 API、Prompt（零样本/少样本/思维链）、结构化输出、上下文窗口、流式输出、异常处理、成本统计、结果缓存 | `week1-llm-basics/` |
| 第 2 周 | 工具调用与函数编排 | Tool Calling、参数 Schema、工具路由、结果回传、并行调用、超时重试熔断、工具检索式选择 | `week2-tool-calling/` |
| 第 3 周 | Agent 循环与任务规划 | 工具选择、连续调用、条件分支、停止条件、任务状态、手写 ReAct、反思修订、规划执行、多 Agent 协作 | `week3-agent-loop/` |
| 第 4 周 | RAG 知识库 | 文档解析、切片策略、Embedding、向量检索、BM25、混合检索、查询改写、Reranking、引用溯源 | `week4-rag/` |
| 第 5 周 | 记忆与工作流 | 会话历史、摘要记忆、长期记忆、持久化检查点、工作流编排（并行/分支）、中断恢复、人工审批队列 | `week5-memory-workflow/` |
| 第 6 周 | MCP 与工具生态 | MCP Client / Server、多 Server 聚合、工具发现、资源订阅、提示模板、访问授权、HTTP 传输 | `week6-mcp/` |
| 第 7 周 | 评估、安全与性能 | 离线测试集（22 例）、回归对比、工具调用准确率、注入防护测试、权限校验、成本守卫、Token 预算、轨迹报告 | `week7-eval-security/` |
| 第 8 周 | 全栈项目交付 | 前后端联调、SSE 推送、任务进度、鉴权限流、指标观测、持久化、容器部署 | `week8-fullstack/` |

各周交付的实战成果：

1. 带 Vue 前端的 AI 对话应用，支持连续对话与 Markdown 渲染
2. 能查天气、检索项目列表、查业务指标的 Agent
3. 接到目标后自主查数据、分析结果、生成报告的 Agent
4. 上传业务文档和技术手册，按资料回答问题的 Agent
5. 可以暂停、确认、继续执行的业务 Agent
6. 把现有业务查询接口封装成 MCP 工具
7. 为已有 Agent 写测试用例、记录执行轨迹、测异常与越权场景
8. 可以演示、测试和部署的完整业务 Agent 平台

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env   # 填入 OPENAI_API_KEY / OPENAI_MODEL

# 3. 运行第 8 周完整平台（含调试演示页）
npm run dev            # http://localhost:3000
```

## 常用脚本

| 脚本 | 说明 |
| --- | --- |
| `npm run dev` | 启动第 8 周 Agent 平台（端口 3000） |
| `npm run dev:week1` | 启动第 1 周对话服务（端口 3001） |
| `npm run week1:hello` | 最小模型调用 |
| `npm run week1:stream` | 流式输出 |
| `npm run week2:router` | 多工具路由与失败处理 |
| `npm run week3:report` | 自主取数并生成报告的 Agent |
| `npm run week4:rag` | RAG 检索问答（含引用溯源） |
| `npm run week5:memory` | 会话记忆（Checkpointer） |
| `npm run week5:approval` | 人工审批与中断恢复 |
| `npm run week6:mcp` | MCP Client 调用 MCP Server |
| `npm run week7:eval` | 评估 + 安全 + 性能流水线 |
| `npm run week7:regression` | 评测回归对比（有回归则退出码 1） |
| `npm run week7:injection` / `week7:trace` | 注入防护测试 / 轨迹报告（纯本地，无需模型） |
| `npm run week1:patterns` / `week1:params` / `week1:cost` / `week1:cache` | 提示词模式 / 模型参数 / 成本账本 / 结果缓存 |
| `npm run week2:parallel` / `week2:resilience` / `week2:tool-search` | 并行调用 / 工具容错 / 工具检索式选择 |
| `npm run week3:react` / `week3:reflection` / `week3:planner` / `week3:multi` | 手写 ReAct / 反思修订 / 规划执行 / 多 Agent 协作 |
| `npm run week4:chunking` / `week4:bm25` / `week4:rewrite` / `week4:rerank` | 切片策略 / BM25 / 查询改写 / 重排（前两个无需模型） |
| `npm run week5:summary` / `week5:persist` / `week5:workflow` / `week5:approval-queue` | 摘要记忆 / 持久化恢复 / 工作流编排 / 审批队列 |
| `npm run week6:mcp-multi` / `week6:mcp-resources` / `week6:mcp-http-server` / `week6:mcp-http-client` | 多 Server 聚合 / 资源订阅 / HTTP 传输 |

任意单个文件也可直接运行：

```bash
npx tsx src/week2-tool-calling/tool-calling.ts
```

## 说明

- 所有 demo 共用根目录 `.env` 中的 `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL`。
- 第 4 周**未使用** `MemoryVectorStore`：`@langchain/core` v1 已移除该类，改为手写内存向量库，顺带讲清混合检索与重排原理。
- 第 6 周需要额外依赖 `@modelcontextprotocol/sdk`、`@langchain/mcp-adapters`（已在 `package.json` 中声明）。
