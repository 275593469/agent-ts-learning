import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 学习目标：结果缓存（Cache）
// 模型调用是「又慢又贵」的外部依赖，重复问题没必要重复计算：
//   · 相同问题（命中率最高的场景：固定话术、FAQ、指标口径解释）
//   · 官方参数表、单位换算、权限说明这类答案基本不变的问法
// 这里实现一个带 TTL + 上限的内存缓存，并统计命中率与节省的 token。
// 运行：npx tsx src/week1-llm-basics/response-cache.ts

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

interface CacheEntry {
  answer: string;
  expiresAt: number;
  /** 这条缓存曾服务过多少次请求 */
  hits: number;
}

/**
 * 简单的 TTL + 容量上限缓存。
 * 生产环境应换成 Redis：多实例共享、支持主动失效。
 */
class AnswerCache {
  private readonly store = new Map<string, CacheEntry>();
  private lookups = 0;
  private hits = 0;
  private savedTokens = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number
  ) {}

  /** 缓存键：问题归一化（去空格、统一小写），避免“同义不同串” */
  private static keyOf(question: string): string {
    return question.replace(/\s+/g, "").toLowerCase();
  }

  get(question: string): string | null {
    this.lookups += 1;
    const key = AnswerCache.keyOf(question);
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }

    entry.hits += 1;
    this.hits += 1;
    return entry.answer;
  }

  set(question: string, answer: string): void {
    const key = AnswerCache.keyOf(question);

    // 超过容量时淘汰最早写入的一条（简易 FIFO，够演示用）
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next();
      if (!oldest.done) {
        this.store.delete(oldest.value);
      }
    }

    this.store.set(key, {
      answer,
      expiresAt: Date.now() + this.ttlMs,
      hits: 0,
    });
  }

  recordSaved(tokens: number): void {
    this.savedTokens += tokens;
  }

  snapshot(): { hitRate: string; savedTokens: number; size: number } {
    return {
      hitRate: this.lookups === 0 ? "0%" : `${((this.hits / this.lookups) * 100).toFixed(1)}%`,
      savedTokens: this.savedTokens,
      size: this.store.size,
    };
  }
}

const cache = new AnswerCache(5 * 60 * 1000, 20);

/** 带缓存的问答入口：命中直接返回，未命中才真正调用模型 */
async function ask(question: string): Promise<{ answer: string; fromCache: boolean }> {
  const cached = cache.get(question);
  if (cached !== null) {
    return { answer: cached, fromCache: true };
  }

  const response = await model.invoke([
    new SystemMessage("你是一名园区设施运维助手，回答控制在 60 字以内。"),
    new HumanMessage(question),
  ]);

  const answer =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const usage = response.usage_metadata as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | undefined;
  // 命中缓存相当于省下一次完整的输入 + 输出
  cache.recordSaved((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0));
  cache.set(question, answer);

  return { answer, fromCache: false };
}

const questions = [
  "A座空调机组的巡检周期是多久？",
  "B座电梯一个月巡检几次？", // 与上一句语义相近但缓存键不同，会 miss
  "  A座空调机组的巡检周期是多久？  ", // 归一化后与第一句相同，应命中
  "A座空调机组的巡检周期是多久？", // 命中
];

const main = async () => {
  for (const question of questions) {
    const result = await ask(question);

    console.log(`\n问题：${question.trim()}`);
    console.log(`来源：${result.fromCache ? "缓存命中（未调用模型）" : "模型调用"}`);
    console.log(`回答：${result.answer.trim()}`);
  }

  const snapshot = cache.snapshot();
  console.log("\n缓存统计：");
  console.log(`  命中率：${snapshot.hitRate}`);
  console.log(`  节省 token：${snapshot.savedTokens}`);
  console.log(`  缓存条目：${snapshot.size}`);

  console.log(
    "\n注意：\n" +
      "  1. 简单字符串缓存只能匹配“完全一样（归一化后）”的问题，\n" +
      "     “一个月几次”和“巡检周期是多久”语义相近却不会命中；\n" +
      "  2. 要做到语义命中，需要 Embedding 相似度缓存（第 4 周学完向量检索后可自行实现）；\n" +
      "  3. 涉及实时数据的问答（今天能耗多少）不能缓存，必须按数据时效设置 TTL 或直接绕过。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
