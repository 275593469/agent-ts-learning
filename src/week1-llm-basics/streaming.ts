import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 学习目标：流式输出（Streaming）
// 普通 invoke 要等模型生成完整个回答才返回；stream 会按 token 逐个吐出，
// 这是“打字机效果”和前端 SSE 推送的基础。

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

const model = new ChatOpenAI({
  apiKey,
  model: modelName,
  temperature: 0.5,
  streaming: true,
  ...(baseURL ? { configuration: { baseURL } } : {}),
});

const main = async () => {
  const stream = await model.stream([
    new SystemMessage("你是一名中文技术助手，回答尽量简洁。"),
    new HumanMessage(
      "用三句话说明什么是流式输出，以及它在前端对话应用中的价值。"
    ),
  ]);

  process.stdout.write("助手：");

  for await (const chunk of stream) {
    // chunk.content 可能是字符串，也可能是内容块数组
    const text =
      typeof chunk.content === "string"
        ? chunk.content
        : chunk.content
            .map((part) => ("text" in part ? part.text : ""))
            .join("");

    process.stdout.write(text);
  }

  process.stdout.write("\n");
};

main().catch((error: unknown) => {
  console.error("调用失败：", error);
  process.exitCode = 1;
});
