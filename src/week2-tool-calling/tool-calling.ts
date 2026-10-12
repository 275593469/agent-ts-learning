import "dotenv/config";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { type BaseMessage, SystemMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";


// 模拟设备数据，后续会替换为真实设施管理系统（FMS）接口
const devices = [
  { id: "D001", type: "空调机组", area: "A座", status: "正常" },
  { id: "D002", type: "电梯", area: "A座", status: "异常" },
  { id: "D003", type: "门禁", area: "B座", status: "正常" },
  { id: "D004", type: "空调机组", area: "B座", status: "正常" },
  { id: "D005", type: "电梯", area: "C座", status: "异常" },
];

// 定义工具：按区域查询设备数量
const countDevicesTool = tool(
  async ({ area }) => {
    const matchedDevices =
      area === "全部"
        ? devices
        : devices.filter((device) => device.area === area);

    return JSON.stringify({
      area,
      count: matchedDevices.length,
      devices: matchedDevices,
    });
  },
  {
    name: "count_devices",
    description:
      "查询指定区域的园区设施设备数量和设备明细。area 使用 A座、B座、C座或全部。",
    schema: z.object({
      area: z.enum(["A座", "B座", "C座", "全部"]),
    }),
  }
);

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey || !modelName) {
    throw new Error("请检查 OPENAI_API_KEY 和 OPENAI_MODEL");
  }

  const model = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
    ...(baseURL
      ? { configuration: { baseURL } }
      : {}),
  });

  // 将工具的定义提供给模型
  const modelWithTools = model.bindTools([countDevicesTool]);

  // 显式声明消息类型，后续会把 AI 消息和工具消息追加进来
  const messages: BaseMessage[] = [
    new SystemMessage(
      "你是园区设施数据助手。需要查询设备数据时，请调用对应工具，不要猜测设备数量。"
    ),
    new HumanMessage("B座有多少台设备？"),
  ];

  // 第一次调用：模型可能返回工具调用请求
  const aiMessage = await modelWithTools.invoke(messages);

  console.log("模型内容：", aiMessage.content);
  console.log("工具调用请求：", aiMessage.tool_calls);

  // 处理工具调用请求
  if (!aiMessage.tool_calls?.length) {
    console.log("模型没有请求调用工具。");
    return;
  }

  messages.push(aiMessage);

  for (const toolCall of aiMessage.tool_calls) {
    if (toolCall.name !== countDevicesTool.name) {
      throw new Error(`不允许执行未知工具：${toolCall.name}`);
    }

    // 工具结果必须绑定到调用 id，否则模型无法把结果与调用请求对应起来
    if (!toolCall.id) {
      throw new Error(`工具调用缺少 id，无法回传结果：${toolCall.name}`);
    }

    try {
      // 传入完整的 ToolCall：LangChain 会按 schema 校验 args，并直接返回 ToolMessage
      const toolMessage = await countDevicesTool.invoke(toolCall);

      // 将工具结果交还给模型
      messages.push(toolMessage);
    } catch (error) {
      // 参数校验或工具执行失败时，把错误信息回传给模型，避免整体流程中断
      messages.push(
        new ToolMessage({
          tool_call_id: toolCall.id,
          name: toolCall.name,
          status: "error",
          content: `工具执行失败：${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  // 第二次调用：模型根据工具结果生成回答
  const finalMessage = await model.invoke(messages);
  console.log("\n最终回答：");
  console.log(finalMessage.content);
}

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
