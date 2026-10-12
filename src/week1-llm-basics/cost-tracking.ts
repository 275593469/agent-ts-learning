import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// 学习目标：Token 用量与成本统计
// 模型每次返回都会带上 usage_metadata（输入/输出 token 数），累计起来就是账单。
// 生产环境必须做这一步：否则“一次对话到底花多少钱”永远说不清。
// 运行：npx tsx src/week1-llm-basics/cost-tracking.ts

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

/** 每 100 万 token 的价格（美元）。价格会变，这里只做量级演示 */
interface Price {
  input: number;
  output: number;
}

const PRICE_TABLE: Record<string, Price> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

const DEFAULT_PRICE: Price = { input: 0.5, output: 1.5 };

function priceOf(model: string): Price {
  return PRICE_TABLE[model] ?? DEFAULT_PRICE;
}

/**
 * 模型返回的 token 用量。
 * LangChain 各版本对 usage_metadata 的类型收敛不一致，这里显式声明用到的字段，
 * 避免依赖框架内部类型定义。
 */
export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/** 会话账本：累计 token 与费用，并支持按模型估算 */
class CostTracker {
  private usage: Usage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(
    private readonly model: string,
    private readonly label: string
  ) {}

  /** 记录一次模型调用的用量 */
  record(message: AIMessage): void {
    const usage = message.usage_metadata as TokenUsage | undefined;

    this.usage.calls += 1;
    this.usage.inputTokens += usage?.input_tokens ?? 0;
    this.usage.outputTokens += usage?.output_tokens ?? 0;
  }

  /** 估算累计费用（美元） */
  get cost(): number {
    const price = priceOf(this.model);
    return (
      (this.usage.inputTokens / 1_000_000) * price.input +
      (this.usage.outputTokens / 1_000_000) * price.output
    );
  }

  print(): void {
    console.log(`\n—— 账本：${this.label}（模型 ${this.model}） ——`);
    console.log(`  调用次数：${this.usage.calls}`);
    console.log(`  输入 token：${this.usage.inputTokens}`);
    console.log(`  输出 token：${this.usage.outputTokens}`);
    console.log(`  预估费用：$${this.cost.toFixed(6)}`);
  }
}

const model = new ChatOpenAI({
  apiKey,
  model: modelName,
  temperature: 0.3,
  ...(baseURL ? { configuration: { baseURL } } : {}),
});

const tracker = new CostTracker(modelName, "多轮对话");

const systemMessage = new SystemMessage(
  "你是一名园区设施运维助手，回答控制在 50 字以内。"
);
const history: BaseMessage[] = [];

/** 一轮对话：注意历史越长，输入 token 越多，成本随轮次上升 */
async function chat(question: string): Promise<string> {
  history.push(new HumanMessage(question));

  const response = await model.invoke([systemMessage, ...history]);
  history.push(new AIMessage(response.content));
  tracker.record(response);

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

const questions = [
  "B座空调机组的巡检周期是多久？",
  "那电梯呢？",
  "如果发现异常，多久之内要上报？",
];

const main = async () => {
  for (const [index, question] of questions.entries()) {
    const answer = await chat(question);
    const usage = history.length;

    console.log(`\n第 ${index + 1} 轮`);
    console.log(`用户：${question}`);
    console.log(`助手：${answer.trim()}`);
    console.log(`（当前历史消息数：${usage}）`);
  }

  tracker.print();

  console.log(
    "\n要点：\n" +
      "  1. 每轮的输入 = 系统提示词 + 全部历史，所以轮次越多单轮越贵；\n" +
      "  2. 这也是上下文窗口需要裁剪（滑动窗口 / 摘要）的经济原因，不只是长度限制；\n" +
      "  3. 把 usage 落到日志或监控里，才能做预算告警与成本归因。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
