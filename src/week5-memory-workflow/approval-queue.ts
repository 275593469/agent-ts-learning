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

// 学习目标：人工审批队列（Approval Queue）
// human-approval.ts 演示了单个请求的中断与恢复。
// 真实系统里同时会有多个高危操作排队待审，需要：
//   1. 用 thread_id 隔离每个审批单（互不干扰）
//   2. 能列出「当前所有待审批项」及其上下文
//   3. 支持逐个决议（通过 / 驳回），支持驳回理由
//   4. 决议后恢复执行并留痕（谁批的、什么时候、结果如何）
// 运行：npx tsx src/week5-memory-workflow/approval-queue.ts

// ---------- 1. 状态与图 ----------

const ApprovalState = Annotation.Root({
  /** 申请内容，例如「远程重启 B座 3 号空调机组」 */
  request: Annotation<string>,
  /** 申请人 */
  requester: Annotation<string>,
  /** 风险等级，用于展示与分级审批 */
  risk: Annotation<"低" | "中" | "高">,
  /** 审批决议 */
  decision: Annotation<"approve" | "reject" | "pending">({
    reducer: (_prev, next) => next,
    default: () => "pending",
  }),
  /** 驳回理由 */
  comment: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  /** 执行结果 */
  result: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

interface ApprovalPayload {
  type: "approval";
  request: string;
  requester: string;
  risk: string;
  question: string;
  options: string[];
}

/** 审批节点：中断并抛出待审批信息 */
async function reviewNode(state: typeof ApprovalState.State) {
  const payload: ApprovalPayload = {
    type: "approval",
    request: state.request,
    requester: state.requester,
    risk: state.risk,
    question: `是否批准【${state.request}】？申请人：${state.requester}，风险：${state.risk}`,
    options: ["approve", "reject"],
  };

  const decision = interrupt(payload) as string;

  return { decision: decision === "approve" ? "approve" : "reject" };
}

/** 执行节点：只有审批通过才真正执行 */
async function executeNode(state: typeof ApprovalState.State) {
  if (state.decision !== "approve") {
    return { result: `【已驳回】未执行：${state.request}｜理由：${state.comment || "未填写"}` };
  }

  // 高危操作执行前再校验一次前置条件（双人复核、维护窗口等）
  return { result: `【已执行】${state.request}（审批人已确认，操作已记录审计日志）` };
}

const checkpointer = new MemorySaver();

const graph = new StateGraph(ApprovalState)
  .addNode("review", reviewNode)
  .addNode("execute", executeNode)
  .addEdge(START, "review")
  .addEdge("review", "execute")
  .addEdge("execute", END)
  .compile({ checkpointer });

// ---------- 2. 队列管理：提交 / 列表 / 决议 ----------

interface PendingItem {
  threadId: string;
  payload: ApprovalPayload;
}

const pending: PendingItem[] = [];

function configOf(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

/** 提交申请：流程会停在 review 节点，并把待审信息放进内存队列 */
async function submit(
  threadId: string,
  request: string,
  requester: string,
  risk: "低" | "中" | "高"
): Promise<void> {
  await graph.invoke({ request, requester, risk }, configOf(threadId));

  // 从检查点里读回中断信息（真实系统从数据库查待办表）
  const snapshot = await graph.getState(configOf(threadId));
  const interrupts = snapshot.tasks.flatMap((task) => task.interrupts);

  for (const item of interrupts) {
    pending.push({ threadId, payload: item.value as ApprovalPayload });
  }

  console.log(`[提交] ${threadId}｜${request}｜申请人 ${requester}｜风险 ${risk}`);
}

/** 列出当前待审批队列 */
function list(): void {
  console.log(`\n================ 待审批队列（${pending.length} 项） ================`);

  if (pending.length === 0) {
    console.log("  （空）");
    return;
  }

  for (const item of pending) {
    console.log(`  · ${item.threadId}｜${item.payload.request}`);
    console.log(
      `      申请人 ${item.payload.requester}｜风险 ${item.payload.risk}｜可选决议 ${item.payload.options.join(" / ")}`
    );
  }
}

/** 决议：从队列移除并恢复执行，返回执行结果 */
async function decide(
  threadId: string,
  decision: "approve" | "reject",
  comment = ""
): Promise<string> {
  const index = pending.findIndex((item) => item.threadId === threadId);

  if (index < 0) {
    throw new Error(`队列中没有待审批项：${threadId}`);
  }

  pending.splice(index, 1);

  const resumed = await graph.invoke(
    new Command({ resume: decision }),
    configOf(threadId)
  );

  const log = `${new Date().toISOString()}｜${threadId}｜决议=${decision}｜备注=${comment || "无"}`;
  console.log(`[决议] ${log}`);

  return String(resumed.result ?? "");
}

// ---------- 3. 演示：三个申请，不同处理方式 ----------

const main = async () => {
  console.log("================ 1. 提交审批申请 ================");

  await submit("ap-1001", "远程重启 B座 3 号空调机组", "小林", "中");
  await submit("ap-1002", "停用 A座中央空调主机并切换备用机组", "小王", "高");
  await submit("ap-1003", "批量修改 C座门禁放行时段", "小张", "低");

  list();

  console.log("\n================ 2. 逐个决议 ================");

  console.log("\nap-1001 -> 通过");
  console.log("  ", await decide("ap-1001", "approve"));

  console.log("\nap-1002 -> 驳回（高风险，需要现场确认）");
  console.log("  ", await decide("ap-1002", "reject", "高负荷时段禁止切换主机"));

  console.log("\nap-1003 -> 通过");
  console.log("  ", await decide("ap-1003", "approve"));

  list();

  console.log("\n================ 3. 审计：读取历史决议 ================");
  for (const threadId of ["ap-1001", "ap-1002", "ap-1003"]) {
    const state = await graph.getState(configOf(threadId));
    const values = state.values as typeof ApprovalState.State;
    console.log(
      `  ${threadId}｜决议=${values.decision}｜结果=${values.result || "（无）"}`
    );
  }

  console.log(
    "\n工程要点：\n" +
      "  · threadId 就是审批单号，用它把「状态」和「人的操作」绑定起来；\n" +
      "  · 待审批列表本质上是一张数据库表（含申请人、风险、超时时间），\n" +
      "    MemorySaver 只是演示，生产要用可查询的持久化实现；\n" +
      "  · 高危操作建议叠加：超时未审批自动驳回、双人会签、维护窗口校验；\n" +
      "  · 决议与执行结果都要写审计日志，便于追溯“谁批的、批了什么”。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
