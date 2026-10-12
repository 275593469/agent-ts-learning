import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { rawDocuments } from "./documents.js";
import { splitDocuments } from "./splitter.js";
import { createEmbeddings, createLocalEmbeddings, type EmbeddingModel } from "./embedding.js";
import { HybridRetriever } from "./retriever.js";

// 学习目标：查询改写与多路召回（Query Rewriting / Multi-Query）
// 用户的问法往往和文档措辞对不上（“电梯老出事” vs “电梯困人处置流程”），
// 单靠一次检索很容易漏。做法是先用模型把问题改写成几个「不同角度」的查询，
// 分别检索后合并去重，召回率通常明显提升。
// 运行：npx tsx src/week4-rag/query-rewrite.ts

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

// ---------- 1. 用结构化输出做改写，避免解析自然语言 ----------

const RewriteSchema = z.object({
  keywords: z.string().describe("提炼出的检索关键词，用空格分隔，不要整句"),
  synonyms: z.string().describe("把口语表达换成文档更可能使用的书面术语"),
  expanded: z.string().describe("补全上下文后的完整问句，适合语义检索"),
});

const rewriter = model.withStructuredOutput(RewriteSchema, { name: "rewrite_query" });

const REWRITE_PROMPT = `你是检索系统的查询改写器。
用户会用口语提问，而知识库是规范文档。请把问题改写成三种互补的检索表达：
1. keywords：只保留核心名词与术语，去掉疑问词；
2. synonyms：把口语词替换为可能的书面同义词（例如“老出事”→“异常”“故障”“困人”）；
3. expanded：补全背景的完整问句，用于语义检索。
不要回答问题本身，只做改写。`;

// ---------- 2. 检索器构建（在线 Embedding 优先，失败降级本地） ----------

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

// ---------- 3. 多路召回 + RRF 合并 ----------

interface MergedHit {
  source: string;
  preview: string;
  /** 被多少个改写查询召回 */
  hitBy: number;
  fusedScore: number;
}

async function retrieve(queries: string[], k: number): Promise<MergedHit[]> {
  const retriever = await buildRetriever();
  const fused = new Map<string, MergedHit>();

  for (const query of queries) {
    const hits = await retriever.retrieve(query, k);

    hits.forEach((hit, rank) => {
      // 用「来源 + 片段前缀」作为去重键，避免同一片段被重复计入
      const key = `${hit.document.metadata.source}#${hit.document.pageContent.slice(0, 24)}`;
      const existing = fused.get(key);

      // RRF：不同查询的排名各贡献 1/(60+rank)，天然可加
      const contribution = 1 / (60 + rank + 1);

      if (existing) {
        existing.hitBy += 1;
        existing.fusedScore += contribution;
      } else {
        fused.set(key, {
          source: String(hit.document.metadata.source ?? "unknown"),
          preview: hit.document.pageContent.replace(/\n/g, " ").slice(0, 50),
          hitBy: 1,
          fusedScore: contribution,
        });
      }
    });
  }

  return Array.from(fused.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}

const QUESTION = "B座那台电梯老是出事，我该怎么处理？";

const main = async () => {
  console.log(`原始问题：${QUESTION}\n`);

  const rewrites = await rewriter.invoke([
    new SystemMessage(REWRITE_PROMPT),
    new HumanMessage(QUESTION),
  ]);

  const queries = [rewrites.keywords, rewrites.synonyms, rewrites.expanded];
  console.log("================ 改写结果 ================");
  console.log(`  keywords：${rewrites.keywords}`);
  console.log(`  synonyms：${rewrites.synonyms}`);
  console.log(`  expanded：${rewrites.expanded}`);

  // 对照组：只用原始口语问题检索
  const baseline = await retrieve([QUESTION], 5);
  const multi = await retrieve(queries, 5);

  console.log("\n================ 单查询召回（口语原句） ================");
  for (const hit of baseline) {
    console.log(`  ${hit.source} — ${hit.preview}...`);
  }

  console.log("\n================ 多路召回合并后 ================");
  for (const hit of multi) {
    console.log(
      `  ${hit.source}（被 ${hit.hitBy} 路召回，融合分 ${hit.fusedScore.toFixed(4)}）— ${hit.preview}...`
    );
  }

  const baselineSources = new Set(baseline.map((item) => item.source));
  const multiSources = new Set(multi.map((item) => item.source));

  console.log("\n================ 覆盖对比 ================");
  console.log(`  单查询命中来源数：${baselineSources.size}`);
  console.log(`  多路召回命中来源数：${multiSources.size}`);
  console.log(
    `  多路召回额外覆盖：${[...multiSources]
      .filter((item) => !baselineSources.has(item))
      .join(", ") || "（无）"}`
  );

  console.log(
    "\n工程要点：\n" +
      "  · 「被多路召回」是很好的相关性信号，可以直接作为重排特征；\n" +
      "  · 改写会增加检索次数（成本 ×N），但只查库不调模型时成本很低，值得做；\n" +
      "  · 改写也可以离线化：把常见问法预先改写并缓存，线上直接用；\n" +
      "  · 别忘了保留「原始查询」这一路 —— 改写可能跑偏，原句是安全网。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
