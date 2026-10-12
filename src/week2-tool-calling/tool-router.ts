import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tools } from "./tools/index.js";

// 学习目标：工具路由（Tool Routing）+ 结果回传 + 调用失败处理
// 模型在多个工具之间自行选择，我们把工具结果或错误回传，直到模型给出最终回答。

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

// 名字 -> 工具实例，用于路由分发
const toolMap = new Map<string, StructuredToolInterface>(
  tools.map((item) => [item.name, item])
);

const SYSTEM_PROMPT = `你是一名企业数据助手，可以查询天气、项目列表和业务指标。
需要数据时必须调用工具，不要凭空编造。一次可以调用多个工具。`;

function errorToolMessage(
  toolCallId: string,
  name: string,
  message: string
): ToolMessage {
  return new ToolMessage({
    tool_call_id: toolCallId,
    name,
    status: "error",
    content: message,
  });
}

async function run(question: string): Promise<string> {
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(question),
  ];

  // 最多循环 5 轮，避免模型陷入无限调用
  for (let step = 1; step <= 5; step++) {
    const aiMessage = await modelWithTools.invoke(messages);

    // 没有工具调用说明模型已经给出最终回答
    if (!aiMessage.tool_calls?.length) {
      return typeof aiMessage.content === "string"
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
    }

    messages.push(aiMessage);

    for (const call of aiMessage.tool_calls) {
      if (!call.id) {
        continue;
      }

      // 1. 工具路由
      const target = toolMap.get(call.name);

      if (!target) {
        messages.push(
          errorToolMessage(call.id, call.name, `未知工具：${call.name}`)
        );
        continue;
      }

      console.log(`  [step ${step}] 调用工具 ${call.name}，参数：${JSON.stringify(call.args)}`);

      try {
        // 2. 执行并把结果回传（invoke(toolCall) 会按 schema 校验参数）
        const toolMessage = await target.invoke(call);
        messages.push(toolMessage);
      } catch (error) {
        // 3. 调用失败处理：把错误当作工具结果回传给模型，让它自行调整
        messages.push(
          errorToolMessage(
            call.id,
            call.name,
            `工具执行失败：${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }
  }

  throw new Error("超过最大工具调用轮数，已中止");
}

const questions = [
  "上海今天天气怎么样？",
  "现在进行中的项目有哪些？",
  "对比一下本月和上月的故障率。",
];

const main = async () => {
  for (const question of questions) {
    console.log(`\n用户：${question}`);
    const answer = await run(question);
    console.log(`助手：${answer}`);
  }
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
