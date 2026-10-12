import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 学习目标：长期记忆（Long-term Memory）
// 会话历史是“短期记忆”，超出窗口就丢了；长期记忆需要把关键事实抽取出来，
// 落到数据库/文件中，下次会话再召回注入。

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

const MEMORY_DIR = path.resolve(process.cwd(), ".memory");

function memoryFile(userId: string): string {
  return path.join(MEMORY_DIR, `${userId}.json`);
}

async function loadFacts(userId: string): Promise<string[]> {
  try {
    const content = await fs.readFile(memoryFile(userId), "utf-8");
    const parsed: unknown = JSON.parse(content);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function saveFacts(userId: string, facts: string[]): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  await fs.writeFile(memoryFile(userId), JSON.stringify(facts, null, 2), "utf-8");
}

/** 从一轮对话中抽取值得长期记住的事实 */
async function extractFacts(text: string): Promise<string[]> {
  const response = await model.invoke([
    new SystemMessage(
      `从下面的对话中抽取需要长期记住的用户事实（身份、职责、偏好、编号等）。
只返回 JSON 字符串数组，例如 ["用户负责B座","用户主要关注能耗强度"]。没有事实则返回 []。
不要输出 JSON 以外的任何内容。`
    ),
    new HumanMessage(text),
  ]);

  const raw = typeof response.content === "string" ? response.content : "";
  const matched = raw.match(/\[[\s\S]*\]/);

  if (!matched) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(matched[0]);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** 回答问题前，把长期记忆注入系统提示词 */
async function answerWithMemory(userId: string, question: string): Promise<string> {
  const facts = await loadFacts(userId);

  const systemPrompt =
    facts.length > 0
      ? `你是一名园区设施运维助手。以下是关于该用户的长期记忆，请结合回答：\n- ${facts.join("\n- ")}`
      : "你是一名园区设施运维助手。当前没有关于该用户的长期记忆。";

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(question),
  ]);

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

/** 记住一轮对话 */
async function remember(userId: string, text: string): Promise<string[]> {
  const newFacts = await extractFacts(text);

  if (newFacts.length === 0) {
    return loadFacts(userId);
  }

  const existing = await loadFacts(userId);
  const merged = Array.from(new Set([...existing, ...newFacts]));
  await saveFacts(userId, merged);

  return merged;
}

const userId = "user-1001";

const main = async () => {
  // 第 1 次会话：产生长期记忆
  const turn1 = "用户：我负责 B座，主要关注能耗强度，常用工单编号前缀是 WO-2024。";
  const facts = await remember(userId, turn1);
  console.log("抽取并保存的长期记忆：");
  console.log(facts.map((item) => `  - ${item}`).join("\n"));

  // 第 2 次会话（模拟新会话）：召回长期记忆
  console.log("\n新会话中提问：我负责哪个区域？主要关注什么指标？");
  const answer = await answerWithMemory(userId, "我负责哪个区域？主要关注什么指标？");
  console.log("助手：", answer);

  console.log(`\n长期记忆文件：${memoryFile(userId)}`);
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
