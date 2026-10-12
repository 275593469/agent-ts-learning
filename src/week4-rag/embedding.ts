import "dotenv/config";
import { OpenAIEmbeddings } from "@langchain/openai";

// 学习目标：Embedding（向量化）
// 把文本映射成高维向量，语义相近的文本向量距离更近，这是向量检索的基础。

/** 检索器只需要这两个能力，做接口隔离后就可以自由替换实现 */
export interface EmbeddingModel {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

/** 在线 Embedding（推荐）：语义能力强，但依赖模型服务且按量计费 */
export function createEmbeddings(): OpenAIEmbeddings {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error("请检查 .env 中的 OPENAI_API_KEY");
  }

  return new OpenAIEmbeddings({
    apiKey,
    model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    // 快速失败，避免降级前长时间重试
    maxRetries: 0,
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });
}

/** 中文场景下按字符 bigram 切词 */
function toBigrams(text: string): string[] {
  const clean = text.replace(/[\s，。、：；（）()]/g, "");
  const grams: string[] = [];

  for (let i = 0; i < clean.length - 1; i++) {
    grams.push(clean.slice(i, i + 2));
  }

  return grams;
}

/** djb2 哈希，用于把 bigram 映射到固定维度 */
function hash(text: string): number {
  let value = 5381;

  for (let i = 0; i < text.length; i++) {
    value = (value * 33) ^ text.charCodeAt(i);
  }

  return Math.abs(value);
}

/**
 * 本地降级 Embedding：把 bigram 哈希到固定维度向量并归一化。
 * 语义能力远不如在线模型，但在 embedding 服务不可用时能让 RAG 流程继续跑，
 * 配合关键词检索依然可用。
 */
export function createLocalEmbeddings(dimension = 256): EmbeddingModel {
  const embed = (text: string): number[] => {
    const vector = new Array<number>(dimension).fill(0);

    for (const gram of toBigrams(text)) {
      const index = hash(gram) % dimension;
      vector[index] = (vector[index] ?? 0) + 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;

    return vector.map((value) => value / norm);
  };

  return {
    embedDocuments: async (texts) => texts.map(embed),
    embedQuery: async (text) => embed(text),
  };
}

/** 余弦相似度：值越接近 1 表示越相似 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
