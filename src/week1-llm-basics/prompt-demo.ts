import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL!,
  temperature: 0.2,
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一名资深全栈开发工程师，请用中文回答，优先给出实用建议。"],
  ["human", "请分析以下开发问题：{question}。技术栈：{techStack}。"],
]);

const chain = prompt.pipe(model);

const main = async () => {
  const result = await chain.invoke({
    question: "如何设计一个支持多轮对话的 Agent 服务？",
    techStack: "Node.js、TypeScript、Vue 3、Spring Boot",
  });

  console.log(result.content);
};

main().catch(console.error);
