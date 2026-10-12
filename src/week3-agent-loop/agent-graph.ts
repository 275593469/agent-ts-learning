import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import {
  StateGraph,
  MessagesAnnotation,
  START,
} from "@langchain/langgraph";
import {
  ToolNode,
  toolsCondition,
} from "@langchain/langgraph/prebuilt";

// 1. 模拟设施管理系统（FMS）设备数据
const devices = [
  { id: "D001", type: "空调机组", area: "A座", status: "正常" },
  { id: "D002", type: "电梯", area: "A座", status: "异常" },
  { id: "D003", type: "门禁", area: "B座", status: "正常" },
  { id: "D004", type: "空调机组", area: "B座", status: "正常" },
  { id: "D005", type: "电梯", area: "C座", status: "异常" },
];

const areaSchema = z.object({
  area: z.enum(["A座", "B座", "C座", "全部"]),
});

// 2. 定义工具：统计设备总数
const countDevicesTool = tool(
  async ({ area }) => {
    const matched =
      area === "全部"
        ? devices
        : devices.filter((item) => item.area === area);

    return JSON.stringify({
      area,
      total: matched.length,
      devices: matched,
    });
  },
  {
    name: "count_devices",
    description: "统计指定区域的设备总数，并返回设备明细。",
    schema: areaSchema,
  }
);

// 3. 定义工具：统计异常设备
const countAbnormalDevicesTool = tool(
  async ({ area }) => {
    const matched = devices.filter(
      (item) =>
        (area === "全部" || item.area === area) &&
        item.status === "异常"
    );

    return JSON.stringify({
      area,
      abnormalCount: matched.length,
      devices: matched,
    });
  },
  {
    name: "count_abnormal_devices",
    description: "统计指定区域的异常设备数量，并返回异常设备明细。",
    schema: areaSchema,
  }
);

const tools = [
  countDevicesTool,
  countAbnormalDevicesTool,
];

// 4. 初始化模型
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
  ...(baseURL
    ? { configuration: { baseURL } }
    : {}),
});

// 让模型知道有哪些工具可以使用
const modelWithTools = model.bindTools(tools);

// 5. 定义 Agent 节点
async function callModel(
  state: typeof MessagesAnnotation.State
) {
  const response = await modelWithTools.invoke(state.messages);

  return {
    messages: [response],
  };
}

// 6. 构建 Agent 工作流
//    agent -> 有工具调用则走 tools 节点 -> 回到 agent，直到没有工具调用为止
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", new ToolNode(tools))
  .addEdge(START, "agent")
  .addConditionalEdges("agent", toolsCondition)
  .addEdge("tools", "agent")
  .compile();

export async function runAgent(question: string): Promise<string> {
  const result = await workflow.invoke(
    {
      messages: [new HumanMessage(question)],
    },
    {
      recursionLimit: 10,
    },
  );

  const lastMessage = result.messages.at(-1);
  const content = lastMessage?.content;

  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content ?? "");
}
