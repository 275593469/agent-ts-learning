# 第 3 周：Agent 循环与任务规划

## 学习内容
工具选择、连续调用、条件分支、停止条件、任务状态、失败恢复。

## 文件说明

| 文件 | 知识点 |
| --- | --- |
| `agent-graph.ts` | LangGraph 最小 Agent：`agent ↔ tools` 循环 + `recursionLimit` 停止条件 |
| `agent-service.ts` | 服务层封装，对外只暴露 `chat(question)` |
| `report-agent.ts` | 规划型 Agent：自主取数 → 分析 → 生成 Markdown 报告 |
| `react-from-scratch.ts` | 手写 ReAct 循环（不用框架）：提示词约定格式 → 解析 → 执行 → 回填 |
| `reflection-agent.ts` | 反思修订：生成 → 评审（打分 + 修改点）→ 修订，循环 2 轮 |
| `task-planner.ts` | 规划-执行：结构化产出子任务清单，再逐步执行并汇总简报 |
| `supervisor-agent.ts` | 多 Agent 协作：Supervisor 用枚举路由调度 3 个专家节点 |

## 运行

```bash
npx tsx src/week3-agent-loop/agent-graph.ts   # 通过 agent-service 调用
npm run week3:report
npm run week3:react
npm run week3:reflection
npm run week3:planner
npm run week3:multi
```

## 本周成果
接到目标后自主查数据、分析结果、生成报告的 Agent（`report-agent.ts`），复用第 2 周工具集。
