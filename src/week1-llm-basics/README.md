# 第 1 周：大模型应用基础

## 学习内容
模型 API、Prompt、结构化输出、上下文窗口、流式输出、异常处理。

## 文件说明

| 文件 | 知识点 | 运行 |
| --- | --- | --- |
| `hello.ts` | 最小调用：Prompt + 模型 + 输出解析 | `npx tsx src/week1-llm-basics/hello.ts` |
| `prompt-demo.ts` | 提示词模板与变量填充 | `npx tsx src/week1-llm-basics/prompt-demo.ts` |
| `structured-output.ts` | 让模型输出 JSON，并用 Zod 做运行时校验 | `npx tsx src/week1-llm-basics/structured-output.ts` |
| `streaming.ts` | 流式输出（打字机效果的底层） | `npx tsx src/week1-llm-basics/streaming.ts` |
| `context-history.ts` | 上下文窗口与多轮历史滑动裁剪 | `npx tsx src/week1-llm-basics/context-history.ts` |
| `error-handling.ts` | 超时、指数退避重试、兜底回复 | `npx tsx src/week1-llm-basics/error-handling.ts` |
| `chat-server.ts` | 带会话的对话 API（前端联调用） | `npm run dev:week1` |
| `prompt-patterns.ts` | 四种提示词模式对比：零样本 / 角色约束 / 少样本 / 思维链 | `npm run week1:patterns` |
| `model-params.ts` | `temperature`、`maxTokens` 对输出的影响（含截断现象） | `npm run week1:params` |
| `structured-output-native.ts` | `withStructuredOutput`：框架代管 schema 与校验 | `npm run week1:structured-native` |
| `cost-tracking.ts` | Token 用量与费用账本（多轮对话成本随轮次上升） | `npm run week1:cost` |
| `response-cache.ts` | 结果缓存：TTL + 容量上限 + 命中率统计 | `npm run week1:cache` |

## 本周成果
带 Vue 前端的 AI 对话应用后端：`chat-server.ts` 提供

- `GET /api/health` 健康检查
- `POST /api/chat` 连续对话（`sessionId` + `question`）
- `DELETE /api/session/:sessionId` 清空会话

前端只需传同一个 `sessionId` 即可实现多轮对话，回答内容为 Markdown，可直接渲染。
