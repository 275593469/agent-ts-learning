import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tools } from "../week2-tool-calling/tools/index.js";

// 学习目标：Agent 循环与任务规划
// 接到一个目标后：自主选择工具 -> 连续调用 -> 汇总数据 -> 生成报告。
// 这里复用第 2 周的工具集（天气/项目/业务指标），展示跨模块的 Agent 组合。

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

const modelWithTools = model.bindTools(tools);

// 规划型系统提示词：先规划、再取数、最后按固定结构输出报告
const PLANNER_PROMPT = `你是一名数据分析 Agent。面对一个目标时，请按以下步骤工作：
1. 规划：拆解目标需要哪些数据，分别用哪个工具获取。
2. 执行：连续调用必要的工具，直到数据齐全。
3. 汇总：基于工具返回的真实数据生成简报，禁止编造数据。
4. 输出：使用 Markdown，包含「结论」「数据依据」「建议」三个部分。`;

// 规划 + 执行节点：模型可能一次给出多个工具调用
async function planAndExecute(state: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke([
    new SystemMessage(PLANNER_PROMPT),
    ...state.messages,
  ]);

  return { messages: [response] };
}

// 停止节点：把最终结果整理成报告
async function writeReport(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke([
    new SystemMessage(
      "把上面的分析整理成一份结构化 Markdown 报告，包含「结论」「数据依据」「建议」。"
    ),
    ...state.messages,
  ]);

  return { messages: [response] };
}

/**
 * 任务是否已经完成（停止条件）：
 * 模型不再请求工具调用，说明已经收集完数据，可以进入报告节点。
 */
function hasGatheredData(state: typeof MessagesAnnotation.State): "tools" | "report" {
  const lastMessage = state.messages.at(-1);

  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    return "tools";
  }

  return "report";
}

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", planAndExecute)
  .addNode("tools", new ToolNode(tools))
  .addNode("report", writeReport)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", hasGatheredData, {
    tools: "tools",
    report: "report",
  })
  .addEdge("tools", "agent")
  .addEdge("report", END)
  .compile();

export async function runReportAgent(goal: string): Promise<string> {
  const result = await workflow.invoke(
    { messages: [new HumanMessage(goal)] },
    // recursionLimit 是防无限循环的“保险丝”，也是停止条件的一部分
    { recursionLimit: 12 }
  );

  const lastMessage = result.messages.at(-1);
  const content = lastMessage?.content;

  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

const main = async () => {
  const goal =
    "分析当前项目交付情况与业务指标：统计进行中的项目、对比本月与上月的设备在线率，并给出风险提示。";

  const report = await runReportAgent(goal);
  console.log(report);
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
