# 第 5 周：记忆与工作流

## 学习内容
会话历史、长期记忆、状态持久化、任务中断恢复、人工审批。

## 文件说明

| 文件 | 知识点 |
| --- | --- |
| `conversation-memory.ts` | Checkpointer + `thread_id`：状态持久化与多会话隔离 |
| `long-term-memory.ts` | 从对话抽取事实 → 落盘 `.memory/*.json` → 下次会话召回 |
| `human-approval.ts` | `interrupt()` 中断 + `Command({ resume })` 恢复，人工审批高危操作 |
| `summary-memory.ts` | 摘要记忆：超出窗口的旧消息压缩成摘要，替代「直接丢弃」 |
| `persistent-checkpoint.ts` | 文件版持久化检查点：重启后 `--resume` 恢复会话（`--reset` 清理） |
| `workflow-graph.ts` | 工作流编排：顺序 + 并行扇出/扇入 + 条件分支（能耗异常才走人工） |
| `approval-queue.ts` | 审批队列：多个待审申请、逐个决议、驳回理由与审计查询 |

## 运行

```bash
npm run week5:memory
npx tsx src/week5-memory-workflow/long-term-memory.ts
npm run week5:approval
npm run week5:summary
npm run week5:persist            # 再执行 npm run week5:persist -- --resume 验证恢复
npm run week5:workflow
npm run week5:approval-queue
```

## 本周成果
可以暂停、确认、继续执行的业务 Agent（`human-approval.ts`）。

## 说明
`MemorySaver` 是内存实现，进程重启即丢失。生产环境可替换为
`@langchain/langgraph-checkpoint-sqlite` / `-postgres` 做真正持久化。
