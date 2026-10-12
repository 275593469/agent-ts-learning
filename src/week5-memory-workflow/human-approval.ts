import "dotenv/config";
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";

// 学习目标：人工审批 + 任务中断恢复
// 高危操作（如远程启停设备）先中断流程、等待人工确认，确认后再继续执行。
// 关键 API：interrupt() 抛出中断，Command({ resume }) 恢复执行。

const ApprovalState = Annotation.Root({
  request: Annotation<string>,
  approved: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  result: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

/** 审批节点：调用 interrupt 暂停，等待外部传入决议 */
async function reviewNode(state: typeof ApprovalState.State) {
  const decision = interrupt({
    type: "approval",
    question: `是否批准执行【${state.request}】？`,
    options: ["approve", "reject"],
  });

  return { approved: decision === "approve" };
}

/** 执行节点：根据审批结果执行或拒绝 */
async function executeNode(state: typeof ApprovalState.State) {
  if (!state.approved) {
    return { result: `【已拒绝】未执行：${state.request}` };
  }

  return { result: `【已批准】已执行：${state.request}` };
}

const checkpointer = new MemorySaver();

const graph = new StateGraph(ApprovalState)
  .addNode("review", reviewNode)
  .addNode("execute", executeNode)
  .addEdge(START, "review")
  .addEdge("review", "execute")
  .addEdge("execute", END)
  .compile({ checkpointer });

async function runApproval(threadId: string, request: string, decision: "approve" | "reject") {
  const config = { configurable: { thread_id: threadId } };

  // 第一次调用：流程会在 review 节点中断
  const paused = await graph.invoke({ request }, config);
  const interrupts = (paused as { __interrupt__?: unknown }).__interrupt__;
  console.log(`[${threadId}] 流程已中断，等待人工审批：`, JSON.stringify(interrupts));

  // 人工作出决议后，用 Command 恢复执行
  const resumed = await graph.invoke(new Command({ resume: decision }), config);
  console.log(`[${threadId}] 人工决议：${decision} -> ${resumed.result}\n`);
}

const main = async () => {
  await runApproval("approval-1", "远程重启 B座 3 号空调机组", "approve");
  await runApproval("approval-2", "停用 A座中央空调主机并切换到备用机组", "reject");
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
