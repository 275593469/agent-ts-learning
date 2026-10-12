import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { estimateTokens } from "./token-budget.js";

// 学习目标：成本守卫（Cost Guard / 降级策略）
// token-budget.ts 只做「记账 + 超限抛错」，但线上不能直接报错给用户。
// 更实用的做法是分档降级：越接近预算上限，行为越保守。
//   level 0（< 60%）   ：正常回答
//   level 1（60% ~ 85%）：压缩上下文（只带最近若干轮）
//   level 2（85% ~ 100%）：限制输出长度 + 要求极简回答
//   level 3（>= 100%） ：拒绝新请求，返回兜底话术（或走缓存/小模型）
// 运行：npx tsx src/week7-eval-security/cost-guard.ts

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

type Level = 0 | 1 | 2 | 3;

interface GuardPlan {
  level: Level;
  /** 允许带入的历史消息条数 */
  maxHistory: number;
  /** 输出长度上限；undefined 表示不限制 */
  maxTokens: number | undefined;
  /** 追加到系统提示词的降级指令 */
  systemSuffix: string;
  /** 是否直接拒绝 */
  reject: boolean;
}

class CostGuard {
  private used = 0;
  private calls = 0;

  constructor(private readonly limit: number) {}

  get ratio(): number {
    return this.used / this.limit;
  }

  get level(): Level {
    if (this.ratio >= 1) {
      return 3;
    }
    if (this.ratio >= 0.85) {
      return 2;
    }
    if (this.ratio >= 0.6) {
      return 1;
    }
    return 0;
  }

  /** 记一次消耗（输入 + 输出都算） */
  consume(input: string, output = ""): void {
    this.calls += 1;
    this.used += estimateTokens(input) + estimateTokens(output);
  }

  /** 根据当前档位给出执行方案 */
  plan(): GuardPlan {
    switch (this.level) {
      case 3:
        return {
          level: 3,
          maxHistory: 0,
          maxTokens: undefined,
          systemSuffix: "",
          reject: true,
        };
      case 2:
        return {
          level: 2,
          maxHistory: 2,
          maxTokens: 80,
          systemSuffix: "当前处于成本保护模式：请极简回答，不超过 30 字，不要展开说明。",
          reject: false,
        };
      case 1:
        return {
          level: 1,
          maxHistory: 4,
          maxTokens: undefined,
          systemSuffix: "请回答得比平时更简短一些，省略客套话。",
          reject: false,
        };
      default:
        return {
          level: 0,
          maxHistory: 10,
          maxTokens: undefined,
          systemSuffix: "",
          reject: false,
        };
    }
  }

  snapshot() {
    return {
      calls: this.calls,
      used: this.used,
      limit: this.limit,
      ratio: `${(this.ratio * 100).toFixed(0)}%`,
      level: this.level,
    };
  }
}

function createModel(maxTokens: number | undefined): ChatOpenAI {
  return new ChatOpenAI({
    apiKey,
    model: modelName!,
    temperature: 0.3,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });
}

const BASE_SYSTEM = "你是一名园区设施运维助手，回答使用中文。";

const history: BaseMessage[] = [];

async function chat(question: string, guard: CostGuard): Promise<string> {
  const plan = guard.plan();

  console.log(
    `\n[档位 ${plan.level}] 已用 ${guard.snapshot().ratio}｜策略：` +
      (plan.reject
        ? "拒绝新请求"
        : `历史 ≤ ${plan.maxHistory} 条，输出上限 ${plan.maxTokens ?? "不限"}`)
  );

  if (plan.reject) {
    // 生产环境这里可以：返回缓存答案、切小模型、或提示“本小时额度已用完”
    return "（成本保护已触发）当前会话额度已用完，请稍后再试，或联系管理员提升配额。";
  }

  const system = plan.systemSuffix
    ? `${BASE_SYSTEM}\n${plan.systemSuffix}`
    : BASE_SYSTEM;

  const recent = history.slice(-plan.maxHistory);

  const response = await createModel(plan.maxTokens).invoke([
    new SystemMessage(system),
    ...recent,
    new HumanMessage(question),
  ]);

  const answer =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  history.push(new HumanMessage(question), new AIMessage(answer));
  guard.consume(question, answer);

  return answer;
}

const questions = [
  "A座空调机组的巡检周期是多久？",
  "那电梯呢？",
  "如果发现异常，多久之内必须上报？",
  "异常设备处理完之后，还需要复检吗？复检的时限是多少？",
  "把这些规定整理成一份给租户看的说明，越详细越好。",
];

const main = async () => {
  // 故意把预算设得很小，方便在一轮演示里走完所有档位
  const guard = new CostGuard(320);

  console.log(`预算上限：320 token（仅用于演示降级过程）`);

  for (const [index, question] of questions.entries()) {
    console.log(`\n第 ${index + 1} 轮｜用户：${question}`);
    console.log(`助手：${await chat(question, guard)}`);
  }

  console.log("\n================ 成本快照 ================");
  console.log(JSON.stringify(guard.snapshot(), null, 2));

  console.log(
    "\n工程要点：\n" +
      "  · 降级要事先设计好「第几档做什么」，而不是等线上打爆后临时加 if；\n" +
      "  · 预算维度可以是：单次请求、单会话、单用户、单小时；口径不同，策略也不同；\n" +
      "  · 拒绝时给明确话术与替代路径（稍后重试、联系管理员），避免用户以为系统坏了；\n" +
      "  · 所有档位切换都要打点上报，否则无法判断“是不是预算设置得过紧”。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
