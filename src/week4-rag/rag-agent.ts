import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { rawDocuments } from "./documents.js";
import { splitDocuments } from "./splitter.js";
import { createEmbeddings, createLocalEmbeddings, type EmbeddingModel } from "./embedding.js";
import { HybridRetriever, type RetrievedChunk } from "./retriever.js";

// 运行：npx tsx src/week4-rag/rag-agent.ts
// 完整链路：文档解析 -> 切片 -> Embedding -> 混合检索 -> Reranking -> 带引用的回答

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

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是企业知识库助手。请严格依据【参考资料】回答，禁止编造。
引用要求：在使用了某条资料的句子末尾标注来源编号，例如 [1]、[2]。
如果参考资料中没有答案，请直接回答“现有资料中未找到相关内容”。`,
  ],
  ["human", "【参考资料】\n{context}\n\n【问题】{question}"],
]);

const chain = prompt.pipe(model).pipe(new StringOutputParser());

/** 把检索结果拼成带编号的上下文，编号与来源一一对应，用于引用溯源 */
function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] 来源：${chunk.document.metadata.source}\n${chunk.document.pageContent}`
    )
    .join("\n\n");
}

function printCitations(chunks: RetrievedChunk[]): void {
  console.log("引用来源：");
  chunks.forEach((chunk, index) => {
    console.log(
      `  [${index + 1}] ${chunk.document.metadata.source} ` +
        `(chunk #${chunk.document.metadata.chunkIndex}, 融合分 ${chunk.score.toFixed(4)})`
    );
  });
}

const questions = [
  "能耗强度的计算公式是什么？行业控制目标是多少？",
  "设备巡检发现异常后应该怎么处理？",
  "空调机组作业安全要求有哪些？",
];

/** 建立索引：优先用在线 Embedding，失败则降级为本地哈希向量 */
async function buildRetriever(chunks: ReturnType<typeof splitDocuments>): Promise<HybridRetriever> {
  const useLocal = process.env.USE_LOCAL_EMBEDDING === "true";
  const candidates: EmbeddingModel[] = useLocal
    ? [createLocalEmbeddings()]
    : [createEmbeddings(), createLocalEmbeddings()];

  let lastError: unknown;

  for (const [index, embeddings] of candidates.entries()) {
    try {
      const retriever = new HybridRetriever(embeddings);
      await retriever.addDocuments(chunks);
      console.log(index === 0 ? "使用在线 Embedding\n" : "在线 Embedding 不可用，已降级为本地哈希向量\n");
      return retriever;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

const main = async () => {
  // 1. 文档解析 + 切片
  const chunks = splitDocuments(rawDocuments, { chunkSize: 140, chunkOverlap: 40 });
  console.log(`原始文档 ${rawDocuments.length} 篇，切片后 ${chunks.length} 段\n`);

  // 2. 建立向量索引
  const retriever = await buildRetriever(chunks);
  console.log(`向量库就绪，共 ${retriever.size} 条切片\n`);

  for (const question of questions) {
    console.log(`================ 问题：${question} ================`);

    // 3. 混合检索 + Reranking
    const topChunks = await retriever.retrieve(question, 3);
    printCitations(topChunks);

    // 4. 带上下文生成回答
    const answer = await chain.invoke({
      context: buildContext(topChunks),
      question,
    });

    console.log("\n回答：");
    console.log(answer);
    console.log();
  }
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
