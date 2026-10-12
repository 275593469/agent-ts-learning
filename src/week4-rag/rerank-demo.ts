import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { rawDocuments } from "./documents.js";
import { splitDocuments } from "./splitter.js";
import { createEmbeddings, createLocalEmbeddings, type EmbeddingModel } from "./embedding.js";
import { HybridRetriever, type RetrievedChunk } from "./retriever.js";

// 学习目标：重排（Reranking）
// 召回阶段追求「快而全」（向量 + 关键词），排序往往不够精细；
// 重排阶段追求「准」（把候选逐个和问题放在一起细看），但慢且贵，
// 所以标准做法是：召回 TopN（20~50）→ 重排 TopK（3~5）。
// 这里用「让模型给相关性打分」模拟 cross-encoder 重排，直观看到排序变化。
// 运行：npx tsx src/week4-rag/rerank-demo.ts

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

// ---------- 1. 模拟 cross-encoder：把「问题 + 片段」一起送进模型打分 ----------

const RerankSchema = z.object({
  score: z.number().min(0).max(10).describe("该片段对回答问题的有用程度，0 完全无关，10 直接可用"),
  reason: z.string().describe("一句话说明打分理由"),
});

const reranker = model.withStructuredOutput(RerankSchema, { name: "score_relevance" });

const RERANK_PROMPT = `你是检索结果评审员。
请判断「资料片段」对回答「用户问题」的有用程度：
- 10 分：片段直接包含答案
- 6-9 分：片段包含关键依据，需要稍作推理
- 1-5 分：主题相关但答不上问题
- 0 分：完全无关
只依据片段内容打分，不要引入外部知识。`;

async function scoreChunk(question: string, text: string) {
  return reranker.invoke([
    new SystemMessage(RERANK_PROMPT),
    new HumanMessage(`【用户问题】${question}\n\n【资料片段】${text}`),
  ]);
}

// ---------- 2. 召回器 ----------

async function buildRetriever(): Promise<HybridRetriever> {
  const chunks = splitDocuments(rawDocuments, { chunkSize: 140, chunkOverlap: 40 });
  const candidates: EmbeddingModel[] =
    process.env.USE_LOCAL_EMBEDDING === "true"
      ? [createLocalEmbeddings()]
      : [createEmbeddings(), createLocalEmbeddings()];

  let lastError: unknown;

  for (const embeddings of candidates) {
    try {
      const retriever = new HybridRetriever(embeddings);
      await retriever.addDocuments(chunks);
      return retriever;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

const QUESTION = "发现设备异常后多久要上报？超时没复检会怎样？";

function printChunks(title: string, chunks: RetrievedChunk[]) {
  console.log(`\n${title}`);
  chunks.forEach((chunk, index) => {
    console.log(
      `  #${index + 1} [融合分 ${chunk.score.toFixed(4)}] ${chunk.document.metadata.source}` +
        `（向量排名 ${chunk.vectorRank ?? "-"} / 关键词排名 ${chunk.keywordRank ?? "-"}）`
    );
    console.log(`      ${chunk.document.pageContent.replace(/\n/g, " ").slice(0, 70)}...`);
  });
}

const main = async () => {
  const retriever = await buildRetriever();

  console.log(`问题：${QUESTION}`);
  console.log(`切片总数：${retriever.size}`);

  // 3. 召回阶段：混合检索取 Top5
  const recalled = await retriever.retrieve(QUESTION, 5);
  printChunks("================ 召回阶段（混合检索 Top5） ================", recalled);

  // 4. 重排阶段：逐个打分
  console.log("\n================ 重排打分 ================");
  const scored = [];

  for (const chunk of recalled) {
    const result = await scoreChunk(QUESTION, chunk.document.pageContent);
    console.log(
      `  ${String(chunk.document.metadata.source)}：${result.score} 分 — ${result.reason}`
    );
    scored.push({ chunk, ...result });
  }

  const reranked = [...scored].sort((a, b) => b.score - a.score);
  const before = recalled.map((item) => item.document.metadata.source);
  const after = reranked.map((item) => item.chunk.document.metadata.source);

  console.log("\n================ 重排前后对比 ================");
  console.log(`  重排前：${before.join(" > ")}`);
  console.log(`  重排后：${after.join(" > ")}`);

  const moved = before.filter((item, index) => after[index] !== item).length;
  console.log(`  位置发生变化的条目：${moved} / ${before.length}`);

  console.log(
    "\n工程要点：\n" +
      "  · 召回看召回率（宁滥勿缺），重排看准确率（宁缺勿滥），两者目标不同；\n" +
      "  · 用大模型打分效果接近商用 rerank 模型，但延迟高、成本高，\n" +
      "    线上更适合用小参数量的 cross-encoder（如 bge-reranker）；\n" +
      "  · 重排结果要写回 trace，否则“为什么这句排在前面”无法复盘；\n" +
      "  · 低于阈值（如 5 分）的片段宁可丢弃，让模型回答“资料中未找到”，\n" +
      "    也不要塞进去诱导它编造。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
