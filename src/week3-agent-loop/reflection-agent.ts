import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 学习目标：反思与自我修订（Reflection / Reflexion）
// 一次生成往往是「能看但不够好」。把「生成 -> 评审 -> 修订」做成循环，
// 用同一个模型的两次不同角色，就能显著提升长文、方案、报告类输出的质量。
// 关键：评审必须给出「可执行的修改点」，否则修订只是换一批词。
// 运行：npx tsx src/week3-agent-loop/reflection-agent.ts

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

/** 生成者需要一点随机性，评审者与修订者要尽量确定 */
function createModel(temperature: number): ChatOpenAI {
  return new ChatOpenAI({
    apiKey,
    model: modelName!,
    temperature,
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });
}

const generator = createModel(0.6);
const reviewer = createModel(0);
const reviser = createModel(0.2);

const TASK = `为「B座 3 号电梯频繁困人」写一份 200 字以内的现场处置方案，
用于贴在电梯厅向租户公示。`;

const GENERATOR_PROMPT =
  "你是园区设施运维主管，请直接输出方案正文，不要输出解释或标题之外的额外内容。";

const REVIEWER_PROMPT = `你是资深的设施安全审核员。请严格审核下面这份方案，输出三部分：
【问题】逐条列出硬伤（缺失关键步骤、责任人不明、时限不清、存在安全风险等）
【评分】0-100 分并说明扣分原因
【修改点】按优先级列出具体到「改哪一句、改成什么」的建议
如果方案没有问题，也必须说明已经覆盖了哪些关键要素。`;

const REVISER_PROMPT = `你是方案撰写人。请根据审核意见修订原方案：
1. 逐条落实【修改点】中优先级最高的部分；
2. 保持公示文本的口吻，简洁、可执行，不超过 200 字；
3. 只输出修订后的方案正文。`;

interface Round {
  index: number;
  draft: string;
  review: string;
  score: number | null;
}

function extractScore(review: string): number | null {
  const matched = /(\d{1,3})\s*分/.exec(review);
  if (!matched?.[1]) {
    return null;
  }
  const score = Number(matched[1]);
  return Number.isFinite(score) ? score : null;
}

async function main() {
  console.log(`任务：${TASK}\n`);

  let draft = (
    await generator.invoke([
      new SystemMessage(GENERATOR_PROMPT),
      new HumanMessage(TASK),
    ])
  ).content as string;

  console.log("================ 初稿 ================");
  console.log(draft.trim());

  const rounds: Round[] = [];
  const MAX_ROUNDS = 2;

  for (let index = 1; index <= MAX_ROUNDS; index++) {
    const reviewMessage = await reviewer.invoke([
      new SystemMessage(REVIEWER_PROMPT),
      new HumanMessage(draft),
    ]);
    const review = typeof reviewMessage.content === "string" ? reviewMessage.content : "";
    const score = extractScore(review);

    rounds.push({ index, draft, review, score });

    console.log(`\n================ 第 ${index} 轮评审 ================`);
    console.log(review.trim());

    const revised = await reviser.invoke([
      new SystemMessage(REVISER_PROMPT),
      new HumanMessage(`【原方案】\n${draft}\n\n【审核意见】\n${review}`),
    ]);

    draft = typeof revised.content === "string" ? revised.content : draft;

    console.log(`\n---------------- 第 ${index} 轮修订稿 ----------------`);
    console.log(draft.trim());
  }

  console.log("\n================ 汇总 ================");
  for (const round of rounds) {
    console.log(
      `  第 ${round.index} 轮：评分 ${round.score ?? "未解析"}，字数 ${round.draft.length}`
    );
  }

  console.log(
    "\n工程要点：\n" +
      "  · 反思循环要有「终止条件」：评分达标、达到最大轮数、或修订稿与上一版差异过小；\n" +
      "  · 评审用 temperature 0 + 固定检查清单，才能稳定复现；\n" +
      "  · 多轮反思的成本是线性的（每轮 = 1 次评审 + 1 次修订），\n" +
      "    只对「高价值、可量化」的产出（报告、方案、代码）开启；\n" +
      "  · 更省钱的做法：把评审标准写进生成提示词，一次成型；\n" +
      "    反思循环留给「一次成型仍然不合格」的复杂任务。"
  );
}

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
