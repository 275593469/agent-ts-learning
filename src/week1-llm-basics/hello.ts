import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error(
    "请在 .env 中配置 OPENAI_API_KEY 和 OPENAI_MODEL"
  );
}

// 1. 初始化模型
const model = new ChatOpenAI({
  apiKey,
  model: modelName,
  temperature: 0,
  ...(baseURL ? { configuration: { baseURL } } : {}),
});

// 2. 创建提示词模板
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一名专业的软件开发助手，请使用中文回答。"],
  ["human", "{question}"],
]);

// 3. 创建输出解析器
const parser = new StringOutputParser();

// 4. 组合 Chain
const chain = prompt.pipe(model).pipe(parser);

// 5. 调用模型
const main = async () => {
  const answer = await chain.invoke({
    question: "用一句话解释什么是 LangChain。",
  });

  console.log(answer);
};

main().catch((error: unknown) => {
  console.error("调用失败：", error);
  process.exitCode = 1;
});
