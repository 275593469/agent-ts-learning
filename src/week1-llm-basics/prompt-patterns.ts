import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

// 学习目标：提示词模式（Prompt Patterns）
// 同一个问题，提示词写法不同，输出质量和稳定性差别很大：
//   1. 零样本：直接提问，最省 token，但格式不可控
//   2. 角色 + 约束：限定身份、口径、输出长度
//   3. 少样本（Few-shot）：给 1~3 个范例，格式立刻稳定
//   4. 思维链（CoT）：要求先推理再给结论，复杂问题准确率更高
// 运行：npx tsx src/week1-llm-basics/prompt-patterns.ts

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

const QUESTION = "A座电梯故障率 1.8%，B座 2.3%，哪一栋更需要优先巡检？";

interface Pattern {
  name: string;
  description: string;
  messages: BaseMessage[];
}

const patterns: Pattern[] = [
  {
    name: "1. 零样本",
    description: "只有一句系统提示词，完全依赖模型自由发挥",
    messages: [
      new SystemMessage("你是一名助手。"),
      new HumanMessage(QUESTION),
    ],
  },
  {
    name: "2. 角色 + 约束",
    description: "限定身份、业务口径与输出长度，减少废话",
    messages: [
      new SystemMessage(
        `你是园区设施运维数据分析师。
回答要求：
1. 先给出结论（一句话），再给出依据；
2. 只使用我提供的数据，不编造其他指标；
3. 总长度不超过 80 字。`
      ),
      new HumanMessage(QUESTION),
    ],
  },
  {
    name: "3. 少样本（Few-shot）",
    description: "给范例，让输出格式完全固定，方便前端直接渲染",
    messages: [
      new SystemMessage(
        `你负责把运维问题整理成固定格式。
格式示例：
输入：C座门禁异常率 0.5%，A座 0.2%，先查哪栋？
输出：结论=A座 | 指标=0.2% | 优先级=低 | 建议=按季度巡检即可

只输出这一行格式，不要解释。`
      ),
      new HumanMessage(QUESTION),
    ],
  },
  {
    name: "4. 思维链（CoT）",
    description: "要求先列推理步骤再下结论，适合需要权衡的判断题",
    messages: [
      new SystemMessage(
        `你是园区设施运维数据分析师。
请按以下结构回答：
【推理】逐步说明比较过程（数据、阈值、影响面）
【结论】一句话给出优先级排序
【建议】下一步动作（可执行）`
      ),
      new HumanMessage(QUESTION),
    ],
  },
];

const main = async () => {
  for (const pattern of patterns) {
    console.log(`\n================ ${pattern.name} ================`);
    console.log(`说明：${pattern.description}`);

    const response = await model.invoke(pattern.messages);
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    console.log("输出：");
    console.log(text.trim());

    const usage = response.usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    if (usage) {
      console.log(`token：输入 ${usage.input_tokens} / 输出 ${usage.output_tokens}`);
    }
  }

  console.log(
    "\n结论：提示词越具体，越不依赖模型的自由发挥。\n" +
      "少样本适合“格式必须稳定”的场景，思维链适合“需要多步推理”的场景，\n" +
      "但两者都会增加 token 成本，需要按业务价值取舍。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
