import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { getBusinessMetricTool } from "../week2-tool-calling/tools/metrics.js";
import { getWeatherTool } from "../week2-tool-calling/tools/weather.js";

// 学习目标：工作流编排（顺序 / 并行 / 条件分支）
// Agent 让模型决定「下一步做什么」，工作流则由开发者把步骤固定下来。
// 二者不是替代关系：涉及钱、权限、对外承诺的流程，通常要用工作流兜住主干，
// 只在「需要判断」的节点交给模型。
// 本例用 LangGraph 编排一条完整链路：
//   START -> 解析 -> [并行]指标 / 天气 / 历史工单 -> 汇总 -> 条件分支 -> END
// 运行：npx tsx src/week5-memory-workflow/workflow-graph.ts

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

const model = new ChatOpenAI({
  apiKey,
  model: modelName,
  temperature: 0,
  ...(baseURL ? { configuration: { baseURL } } : {}),
});

// ---------- 1. 状态定义：每个字段声明自己的 reducer ----------

const WorkflowState = Annotation.Root({
  /** 用户诉求 */
  request: Annotation<string>,
  /** 解析出的楼栋与意图 */
  parsed: Annotation<{ area: string; intent: string }>({
    reducer: (_prev, next) => next,
    default: () => ({ area: "未知", intent: "未知" }),
  }),
  /** 各节点写入的观察结果，用 concat 合并（并行分支的关键） */
  observations: Annotation<string[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  /** 汇总后的结论 */
  conclusion: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  /** 条件分支依据：是否需要人工确认 */
  needsHuman: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  /** 最终交付文本 */
  result: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

// ---------- 2. 节点：解析诉求 ----------

async function parseNode(state: typeof WorkflowState.State) {
  const response = await model.invoke([
    new SystemMessage(
      `从用户诉求中抽取两个字段，直接输出 JSON，例如 {"area":"B座","intent":"能耗异常"}。
area 只能是 A座 / B座 / C座 / 未知；intent 用 6 个字以内概括。`
    ),
    new HumanMessage(state.request),
  ]);

  const text = typeof response.content === "string" ? response.content : "{}";
  const matched = /\{[\s\S]*\}/.exec(text);

  let parsed = { area: "未知", intent: "未知" };
  if (matched) {
    try {
      parsed = JSON.parse(matched[0]) as { area: string; intent: string };
    } catch {
      // 解析失败就用默认值：工作流不应该因为一次格式问题而中断
    }
  }

  console.log(`  [解析] 楼栋=${parsed.area} 意图=${parsed.intent}`);
  return { parsed, observations: [`解析结果：楼栋 ${parsed.area}，意图 ${parsed.intent}`] };
}

// ---------- 3. 三个并行节点 ----------

async function metricNode(state: typeof WorkflowState.State) {
  const metric = state.parsed.intent.includes("能耗") ? "能耗" : "设备在线率";
  const result = await getBusinessMetricTool.invoke({ metric, period: "本月" });

  console.log(`  [并行-指标] ${result}`);
  return { observations: [`本月${metric}：${result}`] };
}

async function weatherNode() {
  const result = await getWeatherTool.invoke({ city: "上海" });

  console.log(`  [并行-天气] ${result}`);
  return { observations: [`上海天气：${result}`] };
}

/** 模拟「查同类历史工单」：真实项目里这是一个只读查询接口 */
async function historyNode(state: typeof WorkflowState.State) {
  const result = JSON.stringify({
    area: state.parsed.area,
    similarOrders: 3,
    topIssue: "空调机组回风温度异常",
  });

  console.log(`  [并行-历史工单] ${result}`);
  return { observations: [`同类历史工单：${result}`] };
}

// ---------- 4. 汇总与条件分支 ----------

async function summarizeNode(state: typeof WorkflowState.State) {
  const response = await model.invoke([
    new SystemMessage("你是园区运维值班长。请基于观察结果给出结论与下一步动作，80 字以内。"),
    new HumanMessage(state.observations.join("\n")),
  ]);

  const conclusion =
    typeof response.content === "string" ? response.content.trim() : "";

  // 条件分支：涉及能耗异常这类需要拍板的场景才走人工确认
  const needsHuman =
    state.parsed.intent.includes("能耗") &&
    state.observations.some((item) => item.includes("异常"));

  console.log(`  [汇总] 需要人工确认：${needsHuman ? "是" : "否"}`);

  return { conclusion, needsHuman };
}

async function autoFinishNode(state: typeof WorkflowState.State) {
  console.log("  [分支] 自动处理通道");

  return {
    result:
      `【已自动处理】${state.conclusion}\n` +
      `（依据 ${state.observations.length} 项观察结果）`,
  };
}

async function humanApprovalNode(state: typeof WorkflowState.State) {
  console.log("  [分支] 人工确认通道（真实系统这里会 interrupt 暂停等待审批）");

  return {
    result:
      `【待人工确认】${state.conclusion}\n` +
      "已生成待办：请设施主管确认是否调整空调运行策略。",
  };
}

// ---------- 5. 组装图 ----------

const workflow = new StateGraph(WorkflowState)
  .addNode("parse", parseNode)
  .addNode("metric", metricNode)
  .addNode("weather", weatherNode)
  .addNode("history", historyNode)
  .addNode("summarize", summarizeNode)
  .addNode("autoFinish", autoFinishNode)
  .addNode("humanApproval", humanApprovalNode)
  .addEdge(START, "parse")
  // 并行扇出：三个节点在同一个 superstep 内并发执行
  .addEdge("parse", "metric")
  .addEdge("parse", "weather")
  .addEdge("parse", "history")
  // 并行扇入：三个分支都完成后才会触发 summarize
  .addEdge("metric", "summarize")
  .addEdge("weather", "summarize")
  .addEdge("history", "summarize")
  .addConditionalEdges(
    "summarize",
    (state) => (state.needsHuman ? "humanApproval" : "autoFinish"),
    { humanApproval: "humanApproval", autoFinish: "autoFinish" }
  )
  .addEdge("autoFinish", END)
  .addEdge("humanApproval", END)
  .compile();

const requests = [
  "B座本月能耗是不是异常偏高？",
  "帮我看看 A 座的设备巡检情况。",
];

const main = async () => {
  for (const request of requests) {
    console.log(`\n================ 诉求：${request} ================`);
    const result = await workflow.invoke({ request });

    console.log("\n最终交付：");
    console.log(result.result);
  }

  console.log(
    "\n工程要点：\n" +
      "  · 并行分支的写入必须靠 reducer（这里用 concat）合并，否则后写的会覆盖先写的；\n" +
      "  · 扇入节点会自动等待所有上游分支完成，不必手写 join 逻辑；\n" +
      "  · 「固定流程 + 少量模型判断」是企业系统最常见的落地姿势，\n" +
      "    比「全部交给 Agent 自主决策」更容易通过合规与评审；\n" +
      "  · 想让人工确认真正卡住流程，把 humanApproval 换成 interrupt（见 human-approval.ts）。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
