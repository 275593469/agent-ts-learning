import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

// 学习目标：异常处理
// 真实调用会遇到：网络抖动、限流(429)、超时、服务不可用(5xx)。
// 生产环境需要：超时控制 + 指数退避重试 + 兜底回复。

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

/** 给单次请求加超时，避免请求一直挂起 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    ),
  ]);
}

/** 指数退避重试：第一次失败等 baseDelay，之后翻倍 */
async function withRetry<T>(
  task: () => Promise<T>,
  retries = 3,
  baseDelay = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const delay = baseDelay * 2 ** (attempt - 1);
      console.warn(`第 ${attempt}/${retries} 次调用失败：${message}，${delay}ms 后重试`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function askWithFallback(question: string): Promise<string> {
  try {
    const result = await withRetry(() =>
      withTimeout(model.invoke([new HumanMessage(question)]), 15_000, "主模型调用")
    );

    return typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);
  } catch (error) {
    // 重试耗尽后走兜底逻辑，保证接口有可预期的返回
    console.error("主模型不可用，返回兜底回复：", error);
    return "抱歉，服务暂时不可用，请稍后重试。";
  }
}

const main = async () => {
  const answer = await askWithFallback("用一句话介绍园区设施管理系统（FMS）的价值。");
  console.log("最终回复：", answer);
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
