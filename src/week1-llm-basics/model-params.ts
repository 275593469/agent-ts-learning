import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 学习目标：模型参数（Model Parameters）
//   temperature：随机性。0 最稳定（适合抽取/分类），1+ 更发散（适合头脑风暴）
//   top_p       ：核采样，与 temperature 二选一调节即可，不要同时大改
//   maxTokens   ：输出长度上限，防止跑飞 + 控制成本（超长会被截断）
// 运行：npx tsx src/week1-llm-basics/model-params.ts

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

/** 统一构造模型，避免每个实验重复配置 */
function createModel(options: { temperature?: number; maxTokens?: number }): ChatOpenAI {
  return new ChatOpenAI({
    apiKey,
    model: modelName!,
    temperature: options.temperature ?? 0,
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });
}

const SYSTEM = "你是一名园区设施运维助手，回答简洁。";
const QUESTION = "给 A 座的电梯做一次月度巡检，写一句巡检要点。";

const experiments = [
  {
    label: "temperature = 0（最稳定）",
    model: createModel({ temperature: 0 }),
    note: "同样的问题多跑几次结果基本一致，适合抽取、分类、结构化输出",
  },
  {
    label: "temperature = 1.2（最发散）",
    model: createModel({ temperature: 1.2 }),
    note: "措辞更跳跃，适合起标题、头脑风暴；但事实类任务容易漂",
  },
  {
    label: "maxTokens = 12（被截断）",
    model: createModel({ temperature: 0, maxTokens: 12 }),
    note: "输出被强行截断，前端会看到半句话 —— 这是要做长度兜底的原因",
  },
];

const main = async () => {
  for (const item of experiments) {
    console.log(`\n================ ${item.label} ================`);

    const response = await item.model.invoke([
      new SystemMessage(SYSTEM),
      new HumanMessage(QUESTION),
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    console.log(`输出：${text.trim()}`);
    console.log(`说明：${item.note}`);

    const usage = response.usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    if (usage) {
      console.log(
        `token：输入 ${usage.input_tokens} / 输出 ${usage.output_tokens}` +
          (item.label.includes("maxTokens") ? "（输出达到上限，被截断）" : "")
      );
    }
  }

  console.log(
    "\n经验法则：\n" +
      "  · 确定性任务（数据抽取、工具参数生成）→ temperature 0\n" +
      "  · 创造性任务（文案、命名、方案发散）→ temperature 0.7 ~ 1.2\n" +
      "  · maxTokens 只做“安全阀”，不要用它来控制排版，排版交给提示词约束"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
