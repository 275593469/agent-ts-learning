import "dotenv/config";
import express from "express";
import cors from "cors";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// 第 1 周交付物的后端：带 Vue 前端的 AI 对话应用
// 支持连续对话（内存会话表 + 滑动窗口），前端可自行用 Markdown 渲染。
// 启动：npx tsx src/week1-llm-basics/chat-server.ts

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

const SYSTEM_PROMPT =
  "你是一名友好的中文 AI 助手，支持多轮连续对话，回答请使用 Markdown 格式。";
const MAX_TURNS = 10;

// 内存中的会话表：sessionId -> 消息历史（生产环境应替换为 Redis / 数据库）
const sessions = new Map<string, BaseMessage[]>();

function getHistory(sessionId: string): BaseMessage[] {
  let history = sessions.get(sessionId);
  if (!history) {
    history = [new SystemMessage(SYSTEM_PROMPT)];
    sessions.set(sessionId, history);
  }
  return history;
}

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "Chat API is running" });
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, question } = req.body ?? {};

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    res.status(400).json({ success: false, message: "sessionId 必须是非空字符串" });
    return;
  }

  if (typeof question !== "string" || !question.trim()) {
    res.status(400).json({ success: false, message: "question 必须是非空字符串" });
    return;
  }

  const history = getHistory(sessionId);
  history.push(new HumanMessage(question));

  try {
    const answer = await model.invoke(history);
    history.push(new AIMessage(answer.content));

    // 滑动窗口裁剪，避免上下文无限增长
    const system = history[0]!;
    const recent = history.slice(1).slice(-MAX_TURNS * 2);
    sessions.set(sessionId, [system, ...recent]);

    res.json({ success: true, data: { answer: answer.content } });
  } catch (error) {
    console.error("对话失败：", error);
    res.status(500).json({ success: false, message: "模型调用失败，请稍后重试" });
  }
});

// 清空某个会话
app.delete("/api/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Week1 Chat API 已启动：http://localhost:${port}`);
});
