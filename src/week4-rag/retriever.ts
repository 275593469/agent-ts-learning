import { Document } from "@langchain/core/documents";
import { cosineSimilarity, type EmbeddingModel } from "./embedding.js";

// 学习目标：向量检索 + 关键词检索 + 混合检索（RRF）+ Reranking
// @langchain/core v1 已不再内置 MemoryVectorStore，这里手写一个内存向量库，
// 顺便把“混合检索”和“重排”的原理讲清楚。

interface StoredChunk {
  document: Document;
  embedding: number[];
}

export interface RetrievedChunk {
  document: Document;
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

/** 中文场景下按字符 bigram 切词，简单但对短文档足够有效 */
function toBigrams(text: string): string[] {
  const clean = text.replace(/[\s，。、：；（）()]/g, "");
  const grams: string[] = [];

  for (let i = 0; i < clean.length - 1; i++) {
    grams.push(clean.slice(i, i + 2));
  }

  return grams;
}

/** 关键词打分：查询 bigram 在文档中出现的次数（词频） */
function keywordScore(queryGrams: string[], text: string): number {
  let score = 0;

  for (const gram of queryGrams) {
    if (text.includes(gram)) {
      score += 1;
    }
  }

  return score;
}

export class HybridRetriever {
  private readonly store: StoredChunk[] = [];

  constructor(private readonly embeddings: EmbeddingModel) {}

  /** 写入阶段：对每个切片生成向量并存入内存 */
  async addDocuments(documents: Document[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    const vectors = await this.embeddings.embedDocuments(
      documents.map((doc) => doc.pageContent)
    );

    documents.forEach((document, index) => {
      this.store.push({ document, embedding: vectors[index] ?? [] });
    });
  }

  get size(): number {
    return this.store.length;
  }

  private async vectorRanking(query: string, topN: number): Promise<number[]> {
    const queryVector = await this.embeddings.embedQuery(query);

    return this.store
      .map((item, index) => ({
        index,
        score: cosineSimilarity(queryVector, item.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((item) => item.index);
  }

  private keywordRanking(query: string, topN: number): number[] {
    const queryGrams = toBigrams(query);

    return this.store
      .map((item, index) => ({
        index,
        score: keywordScore(queryGrams, item.document.pageContent),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((item) => item.index);
  }

  /**
   * 混合检索：
   * 1. 分别做向量召回与关键词召回；
   * 2. 用 RRF（Reciprocal Rank Fusion）融合两路排名，避免量纲不一致；
   * 3. Reranking：用“融合分 + 关键词密度”做二次排序，取 TopK。
   */
  async retrieve(query: string, k = 3): Promise<RetrievedChunk[]> {
    const topN = Math.max(k * 3, 5);
    const queryGrams = toBigrams(query);

    const [vectorHits, keywordHits] = await Promise.all([
      this.vectorRanking(query, topN),
      Promise.resolve(this.keywordRanking(query, topN)),
    ]);

    const fusedScore = new Map<number, number>();
    const vectorRank = new Map<number, number>();
    const keywordRank = new Map<number, number>();

    vectorHits.forEach((index, rank) => {
      fusedScore.set(index, (fusedScore.get(index) ?? 0) + 1 / (60 + rank + 1));
      vectorRank.set(index, rank);
    });

    keywordHits.forEach((index, rank) => {
      fusedScore.set(index, (fusedScore.get(index) ?? 0) + 1 / (60 + rank + 1));
      keywordRank.set(index, rank);
    });

    const reranked = Array.from(fusedScore.entries())
      .map(([index, score]) => {
        const chunk = this.store[index]!;
        // Reranking：融合分 + 关键词命中密度（对“专有名词”类问题更友好）
        const density =
          queryGrams.length === 0
            ? 0
            : keywordScore(queryGrams, chunk.document.pageContent) / queryGrams.length;

        return {
          document: chunk.document,
          score: score + density * 0.02,
          vectorRank: vectorRank.get(index) ?? null,
          keywordRank: keywordRank.get(index) ?? null,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return reranked;
  }
}
