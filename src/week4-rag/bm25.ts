import { rawDocuments } from "./documents.js";
import { splitDocuments } from "./splitter.js";

// 学习目标：BM25 关键词检索
// splitter 里的「bigram 命中次数」只是最简单的词频打分，有两个硬伤：
//   1. 长文档天然命中更多（长度偏置）
//   2. 高频词（如「设备」）权重过高，区分度低
// BM25 用「词频饱和 + 文档长度归一 + IDF 逆文档频率」解决这两点，
// 至今仍是关键词检索的基线（Elasticsearch 默认打分就是它）。
// 运行：npx tsx src/week4-rag/bm25.ts

const K1 = 1.5; // 词频饱和系数：越大越强调“出现次数”
const B = 0.75; // 长度归一系数：0 表示不惩罚长文档，1 表示完全归一

/** 中文按字符 bigram 切词（与 retriever.ts 保持一致，便于对比） */
function tokenize(text: string): string[] {
  const clean = text.replace(/[\s，。、：；（）()]/g, "");
  const tokens: string[] = [];

  for (let i = 0; i < clean.length - 1; i++) {
    tokens.push(clean.slice(i, i + 2));
  }

  return tokens;
}

interface Bm25Index {
  docCount: number;
  avgLength: number;
  /** 每篇文档的词频表 */
  termFreqs: Map<string, number>[];
  docLengths: number[];
  /** 每个词出现在多少篇文档中 */
  docFreq: Map<string, number>;
  chunks: { text: string; source: string }[];
}

function buildIndex(documents: { text: string; source: string }[]): Bm25Index {
  const termFreqs: Map<string, number>[] = [];
  const docFreq = new Map<string, number>();
  const docLengths: number[] = [];

  for (const doc of documents) {
    const tokens = tokenize(doc.text);
    const freq = new Map<string, number>();

    for (const token of tokens) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }

    termFreqs.push(freq);
    docLengths.push(tokens.length);

    // IDF 只关心“出现在几篇文档里”，一篇文档里出现 100 次也只算 1 篇
    for (const token of freq.keys()) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  const avgLength =
    docLengths.reduce((sum, value) => sum + value, 0) / (docLengths.length || 1);

  return {
    docCount: documents.length,
    avgLength,
    termFreqs,
    docLengths,
    docFreq,
    chunks: documents,
  };
}

/** IDF：词越罕见，权重越高（这里用加 1 平滑，避免除零与负数） */
function idf(index: Bm25Index, term: string): number {
  const df = index.docFreq.get(term) ?? 0;
  return Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5));
}

/** 单篇文档对单个词的 BM25 分数 */
function termScore(index: Bm25Index, docIndex: number, term: string): number {
  const freq = index.termFreqs[docIndex]?.get(term) ?? 0;

  if (freq === 0) {
    return 0;
  }

  const docLength = index.docLengths[docIndex] ?? 0;
  const denominator = freq + K1 * (1 - B + (B * docLength) / index.avgLength);

  return idf(index, term) * ((freq * (K1 + 1)) / denominator);
}

interface Bm25Hit {
  rank: number;
  score: number;
  source: string;
  preview: string;
}

function search(index: Bm25Index, query: string, k: number): Bm25Hit[] {
  const queryTerms = Array.from(new Set(tokenize(query)));

  return index.chunks
    .map((chunk, docIndex) => {
      const score = queryTerms.reduce(
        (sum, term) => sum + termScore(index, docIndex, term),
        0
      );

      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((item, rank) => ({
      rank: rank + 1,
      score: Number(item.score.toFixed(3)),
      source: item.chunk.source,
      preview: item.chunk.text.replace(/\n/g, " ").slice(0, 60),
    }));
}

/** 对照实现：纯词频打分（不含 IDF 与长度归一） */
function rawFrequencySearch(index: Bm25Index, query: string, k: number) {
  const queryTerms = Array.from(new Set(tokenize(query)));

  return index.chunks
    .map((chunk, docIndex) => ({
      chunk,
      score: queryTerms.filter((term) => (index.termFreqs[docIndex]?.get(term) ?? 0) > 0).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((item, rank) => ({
      rank: rank + 1,
      score: item.score,
      source: item.chunk.source,
      preview: item.chunk.text.replace(/\n/g, " ").slice(0, 60),
    }));
}

const chunks = splitDocuments(rawDocuments, { chunkSize: 120, chunkOverlap: 30 }).map((doc) => ({
  text: doc.pageContent,
  source: String(doc.metadata.source ?? "unknown"),
}));

const index = buildIndex(chunks);

const queries = [
  "电梯困人怎么处理", // 期望命中：巡检规范 / 安全要求
  "能耗强度怎么算", // 期望命中：能耗分析方法
  "设备在线率的口径", // 期望命中：业务指标口径
];

const main = () => {
  console.log(`索引：${index.docCount} 个切片，平均长度 ${index.avgLength.toFixed(1)} 个 bigram\n`);

  for (const query of queries) {
    console.log(`================ 查询：${query} ================`);

    console.log("BM25：");
    for (const hit of search(index, query, 3)) {
      console.log(`  #${hit.rank} [${hit.score}] ${hit.source} — ${hit.preview}...`);
    }

    console.log("纯词频（对照）：");
    for (const hit of rawFrequencySearch(index, query, 3)) {
      console.log(`  #${hit.rank} [${hit.score}] ${hit.source} — ${hit.preview}...`);
    }

    const idfSamples = Array.from(new Set(tokenize(query)))
      .map((term) => ({ term, idf: Number(idf(index, term).toFixed(2)) }))
      .sort((a, b) => b.idf - a.idf);

    console.log("本次查询词的 IDF（越高越稀有、越有区分度）：");
    console.log(`  ${idfSamples.map((item) => `${item.term}=${item.idf}`).join("  ")}`);
    console.log();
  }

  console.log(
    "结论：\n" +
      "  · IDF 让「困人」「能耗强度」这类稀有词主导排序，避免被「设备」「查询」等高频词淹没；\n" +
      "  · 词频饱和让「出现 10 次」不会比「出现 3 次」强 3 倍多，更符合直觉；\n" +
      "  · 长度归一压制「又长又全」的切片，防止它们靠体量霸榜；\n" +
      "  · 关键词检索擅长专有名词、编号、精确术语，但不懂同义改写（“困人” vs “关人”），\n" +
      "    所以生产上把它和向量检索融合（见 retriever.ts 的 RRF），而不是二选一。"
  );
};

main();
