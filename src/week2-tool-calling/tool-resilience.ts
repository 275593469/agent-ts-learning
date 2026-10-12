import "dotenv/config";
import { z } from "zod";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// 学习目标：工具容错（Timeout / Retry / Fallback / Circuit Breaker）
// 工具背后是真实的下游系统，超时、限流、抖动是常态。
// 做法：不改变工具本身的实现，而是用高阶函数在外层叠加容错能力，
// 并把失败信息作为 ToolMessage（status=error）回传，让模型有机会换路或解释。
// 运行：npx tsx src/week2-tool-calling/tool-resilience.ts

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

// ---------- 1. 三个容错高阶函数 ----------

/** 超时：避免一个慢工具拖死整条链路 */
function withTimeout<T>(task: () => Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    task(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    ),
  ]);
}

/** 重试：指数退避，只适合「偶发失败」（网络抖动、限流） */
async function withRetry<T>(
  task: () => Promise<T>,
  { retries = 3, baseDelay = 200 }: { retries?: number; baseDelay?: number } = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const delay = baseDelay * 2 ** (attempt - 1);
      console.warn(
        `    第 ${attempt}/${retries} 次失败：${
          error instanceof Error ? error.message : String(error)
        }，${delay}ms 后重试`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/** 熔断：连续失败超过阈值后直接快速失败，避免持续打爆下游 */
class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number
  ) {}

  get isOpen(): boolean {
    if (this.failures < this.threshold) {
      return false;
    }

    // 冷却期结束后进入半开状态，放行一次试探请求
    if (Date.now() - this.openedAt > this.cooldownMs) {
      this.failures = this.threshold - 1;
      return false;
    }

    return true;
  }

  onSuccess(): void {
    this.failures = 0;
  }

  onFailure(): void {
    this.failures += 1;
    this.openedAt = Date.now();
  }
}

// ---------- 2. 一个“不稳定”的下游接口 ----------

let attemptCounter = 0;

/** 模拟设备状态查询接口：前两次一定失败，第三次成功 */
async function flakyDeviceApi(area: string): Promise<string> {
  attemptCounter += 1;

  if (attemptCounter <= 2) {
    throw new Error(`设备接口 503（第 ${attemptCounter} 次尝试，${area}）`);
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  return JSON.stringify({ area, total: 5, abnormal: 2 });
}

const areaSchema = z.object({
  area: z.enum(["A座", "B座", "C座", "全部"]).describe("楼栋区域"),
});

/** 原始工具：只关心业务逻辑，不管容错 */
const rawQueryDeviceTool = tool(
  async ({ area }) => flakyDeviceApi(area),
  {
    name: "query_device_status",
    description: "查询指定楼栋的设备数量与异常数量。",
    schema: areaSchema,
  }
);

// ---------- 3. 叠加容错能力 ----------

const breaker = new CircuitBreaker(3, 3_000);

const resilientQueryDeviceTool = tool(
  async ({ area }) => {
    if (breaker.isOpen) {
      throw new Error("下游持续失败，熔断器已打开（请稍后再试或改用缓存数据）");
    }

    try {
      const result = await withRetry(
        () => withTimeout(() => flakyDeviceApi(area), 2_000, "设备接口"),
        { retries: 3, baseDelay: 150 }
      );

      breaker.onSuccess();
      return result;
    } catch (error) {
      breaker.onFailure();
      throw error;
    }
  },
  {
    name: "query_device_status",
    description: "查询指定楼栋的设备数量与异常数量（内置超时、重试与熔断保护）。",
    schema: areaSchema,
  }
);

// ---------- 4. 执行器：失败也要回传给模型 ----------

function errorToolMessage(toolCallId: string, name: string, message: string): ToolMessage {
  return new ToolMessage({
    tool_call_id: toolCallId,
    name,
    status: "error",
    content: `工具执行失败：${message}。请说明情况或改用其他工具，不要编造数据。`,
  });
}

async function runWithTool(
  question: string,
  target: StructuredToolInterface
): Promise<string> {
  const messages: BaseMessage[] = [
    new SystemMessage(
      "你是园区设施数据助手。需要数据时调用工具；工具失败时要如实说明，不要编造。"
    ),
    new HumanMessage(question),
  ];

  for (let step = 1; step <= 4; step++) {
    const aiMessage = await model.bindTools([target]).invoke(messages);

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

      try {
        messages.push(await target.invoke(call));
      } catch (error) {
        messages.push(
          errorToolMessage(
            call.id,
            call.name,
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }
  }

  return "（达到最大轮数仍未结束）";
}

const main = async () => {
  console.log("========== 1. 没有容错：第一次失败就中断 ==========");
  try {
    await rawQueryDeviceTool.invoke({ area: "A座" });
  } catch (error) {
    console.log("  直接抛出：", error instanceof Error ? error.message : String(error));
  }

  console.log("\n========== 2. 加上重试 + 超时：自动恢复 ==========");
  const recovered = await resilientQueryDeviceTool.invoke({ area: "B座" });
  console.log("  最终返回：", recovered);

  console.log("\n========== 3. 交给模型：失败信息也能被解释 ==========");
  attemptCounter = 100; // 手工把计数推高，制造持续失败
  const answer = await runWithTool("A座现在有多少设备异常？", resilientQueryDeviceTool);
  console.log("  助手：", answer.trim());

  console.log(
    "\n选型建议：\n" +
      "  · 网络抖动 / 限流 → 重试（带抖动，避免重试风暴）\n" +
      "  · 下游整体不可用 → 熔断 + 兜底数据（缓存 / 上一周期数据）\n" +
      "  · 参数非法等业务错误 → 不要重试，直接把错误回传模型让它修正参数\n" +
      "  · 写操作（重启设备、派单）不能盲目重试，需要幂等键"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
