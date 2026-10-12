import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// 学习目标：上下文窗口（Context Window）与多轮对话历史管理
// 模型本身是无状态的，多轮记忆靠“把历史消息一起发回去”实现。
// 但上下文长度有限，所以需要滑动窗口 / 摘要等策略来裁剪历史。

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

const model = new ChatOpenAI({
  apiKey,
  model: modelName,
  temperature: 0.3,
  ...(baseURL ? { configuration: { baseURL } } : {}),
});

// 系统提示词永远保留在上下文最前面
const systemMessage = new SystemMessage(
  "你是一名园区设施运维助手，回答要简洁，并且要记住用户之前提到的信息。"
);

/**
 * 上下文窗口有限，历史消息不能无限增长。
 * 这里采用“滑动窗口”策略：只保留最近 maxTurns 轮对话（1 轮 = human + ai）。
 */
function trimHistory(history: BaseMessage[], maxTurns: number): BaseMessage[] {
  const maxMessages = maxTurns * 2;
  return history.slice(-maxMessages);
}

const history: BaseMessage[] = [];
const questions = [
  "我叫小林，负责 B 座的设施巡检。",
  "我负责哪个区域？",
  "你还记得我的名字吗？",
];

const main = async () => {
  for (const question of questions) {
    history.push(new HumanMessage(question));

    // 发送给模型的上下文 = 系统提示词 + 裁剪后的历史
    const context: BaseMessage[] = [
      systemMessage,
      ...trimHistory(history, 6),
    ];

    const answer = await model.invoke(context);
    history.push(new AIMessage(answer.content));

    console.log(`用户：${question}`);
    console.log(`助手：${answer.content}\n`);
  }

  console.log(
    `本轮共产生 ${history.length} 条历史消息，超出窗口的部分会被滑动丢弃。`
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
