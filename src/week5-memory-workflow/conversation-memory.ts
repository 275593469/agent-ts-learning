import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  START,
} from "@langchain/langgraph";

// 学习目标：会话历史 + 状态持久化（Checkpointer）
// 用 thread_id 区分不同会话，LangGraph 会自动把状态存进 checkpointer，
// 下一次调用只需传入“新增的用户消息”，历史由框架自动恢复。

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

const SYSTEM_PROMPT = "你是一名园区设施运维助手，回答简洁，并记住用户之前提到的信息。";

async function callModel(state: typeof MessagesAnnotation.State) {
  // 系统提示词每次临时拼接，不写入历史，避免重复累积
  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ]);

  return { messages: [response] };
}

// 注意：MemorySaver 是内存实现，进程重启即丢失；
// 生产环境可换成 PostgresSaver / SqliteSaver 做真正的持久化。
const checkpointer = new MemorySaver();

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addEdge(START, "agent")
  .compile({ checkpointer });

async function chat(threadId: string, question: string): Promise<string> {
  const result = await graph.invoke(
    { messages: [new HumanMessage(question)] },
    { configurable: { thread_id: threadId } }
  );

  const content = result.messages.at(-1)?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

const main = async () => {
  // 会话 A
  console.log("—— 会话 A（thread-1） ——");
  console.log("用户：我叫小林，负责 B座。");
  console.log("助手：", await chat("thread-1", "我叫小林，负责 B座。"));
  console.log("用户：我负责哪个区域？");
  console.log("助手：", await chat("thread-1", "我负责哪个区域？"));

  // 会话 B：独立的历史，不会串到会话 A
  console.log("\n—— 会话 B（thread-2） ——");
  console.log("用户：我叫什么名字？");
  console.log("助手：", await chat("thread-2", "我叫什么名字？"));
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
