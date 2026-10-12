import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

// 1. 定义业务数据结构
const EventAnalysisSchema = z.object({
  eventType: z.string(),
  riskLevel: z.enum(["低", "中", "高"]),
  reason: z.string(),
  suggestions: z.array(z.string()),
});

type EventAnalysis = z.infer<typeof EventAnalysisSchema>;

// 2. 初始化模型
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
  ...(baseURL
    ? { configuration: { baseURL } }
    : {}),
});

// 3. 要求模型只输出 JSON
const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是园区设施事件分析助手。
请分析事件，并严格返回一个 JSON 对象。
不要输出 Markdown 代码块，不要输出 JSON 以外的文字。

JSON 对象必须包含以下字段：
- eventType：事件类型，字符串
- riskLevel：风险等级，只允许“低”“中”“高”
- reason：判断依据，字符串
- suggestions：处理建议，字符串数组

不要编造输入中不存在的事实。`,
  ],
  ["human", "事件描述：{eventDescription}"],
]);


// 4. 获取纯文本
const chain = prompt.pipe(model).pipe(new StringOutputParser());

const main = async () => {
  const output = await chain.invoke({
    eventDescription:
      "B 座 3 号电梯运行时出现异响并伴随短暂停顿，尚未确认是否为主机故障。",
  });

  // 5. 解析 JSON，并进行运行时校验
  let rawData: unknown;

  try {
    rawData = JSON.parse(output);
  } catch {
    throw new Error(`模型返回的内容不是合法 JSON：${output}`);
  }

  const validation = EventAnalysisSchema.safeParse(rawData);

  if (!validation.success) {
    console.error("模型返回的数据不符合 Schema：");
    console.error(validation.error.issues);
    return;
  }

  const result: EventAnalysis = validation.data;

  console.log(JSON.stringify(result, null, 2));
  console.log("风险等级：", result.riskLevel);
  console.log("处理建议：", result.suggestions);
};

main().catch((error: unknown) => {
  console.error("分析失败：", error);
  process.exitCode = 1;
});
