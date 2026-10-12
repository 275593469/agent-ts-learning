# 第 2 周：工具调用与函数编排

## 学习内容
Tool Calling、参数 Schema、工具路由、结果回传、调用失败处理。

## 文件说明

| 文件 | 知识点 |
| --- | --- |
| `tool-calling.ts` | Tool Calling 最小闭环：一次调用 → 执行 → 二次汇总 |
| `tools/weather.ts` | 查天气工具 |
| `tools/projects.ts` | 检索项目列表 / 查项目详情工具 |
| `tools/metrics.ts` | 查业务指标工具 |
| `tools/index.ts` | 工具注册表（统一导出，供 Agent 复用） |
| `tool-router.ts` | 多工具路由 + 结果回传 + 未知工具/执行失败处理 |
| `parallel-tools.ts` | 并行工具调用：串行 vs 并行耗时对比，`tool_call_id` 绑定 |
| `tool-resilience.ts` | 工具容错：超时、指数退避重试、熔断、失败回传 |
| `tool-search.ts` | 工具检索式选择（Tool RAG）：15 个工具里召回 TopK，省 token 又降错选 |

## 运行

```bash
npx tsx src/week2-tool-calling/tool-calling.ts
npm run week2:router
npm run week2:parallel
npm run week2:resilience
npm run week2:tool-search
```

## 本周成果
能查天气、检索项目列表、查业务指标的 Agent（`tool-router.ts`）。
