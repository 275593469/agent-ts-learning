import type { Response } from "express";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { taskStore, type TaskEvent } from "./task-progress.js";
import { metrics } from "./metrics.js";

// 学习目标：SSE（Server-Sent Events）推送
// 相比 WebSocket，SSE 更轻量，天然适合“服务端单向推送”：模型流式输出、任务进度。

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

const model =
  apiKey && modelName
    ? new ChatOpenAI({
        apiKey,
        model: modelName,
        temperature: 0.3,
        ...(baseURL ? { configuration: { baseURL } } : {}),
      })
    : null;

/** 初始化 SSE 响应头 */
export function initSse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // 长连接的资源占用要能被观测：SSE 连接数是最容易被忽略的一个指标
  metrics.sseOpen();
  res.on("close", () => {
    metrics.sseClose();
  });
}

/** 按 SSE 协议写一条事件 */
export function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 把模型回答以流式方式推送给前端 */
export async function streamChat(res: Response, question: string): Promise<void> {
  if (!model) {
    initSse(res);
    sendSse(res, "error", { message: "模型未配置，请检查 .env" });
    res.end();
    return;
  }

  initSse(res);
  sendSse(res, "start", { question });

  try {
    const stream = await model.stream([
      new SystemMessage("你是一名中文 AI 助手，回答简洁并使用 Markdown。"),
      new HumanMessage(question),
    ]);

    for await (const chunk of stream) {
      const text =
        typeof chunk.content === "string"
          ? chunk.content
          : chunk.content.map((part) => ("text" in part ? part.text : "")).join("");

      if (text) {
        sendSse(res, "token", { text });
      }
    }

    sendSse(res, "done", {});
  } catch (error) {
    sendSse(res, "error", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    res.end();
  }
}

/** 把某个任务的进度事件推送给前端 */
export function streamTask(res: Response, taskId: string): void {
  initSse(res);

  let unsubscribe = () => {
    /* 占位，subscribe 回放历史时可能同步触发回调 */
  };

  const finish = (event: TaskEvent) => {
    sendSse(res, "done", event);
    unsubscribe();
    res.end();
  };

  unsubscribe = taskStore.subscribe(taskId, (event) => {
    sendSse(res, "progress", event);

    if (event.status === "succeeded" || event.status === "failed") {
      finish(event);
    }
  });

  // 客户端断开时清理订阅
  res.on("close", () => {
    unsubscribe();
  });
}
