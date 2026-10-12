import { Document } from "@langchain/core/documents";

// 学习目标：文档切片（Chunking）
// 切片太大 -> 检索噪音多、成本高；切片太小 -> 语义不完整。
// 关键点：保留 metadata（溯源）、相邻片段留 overlap（避免语义被切断）。

export interface SplitOptions {
  /** 每个切片的字符数 */
  chunkSize?: number;
  /** 相邻切片重叠的字符数 */
  chunkOverlap?: number;
}

/**
 * 按固定窗口 + 重叠切分。真实项目可用 RecursiveCharacterTextSplitter，
 * 这里手写实现，方便理解 overlap 的作用。
 */
export function splitDocuments(
  documents: Document[],
  { chunkSize = 140, chunkOverlap = 40 }: SplitOptions = {}
): Document[] {
  if (chunkOverlap >= chunkSize) {
    throw new Error("chunkOverlap 必须小于 chunkSize");
  }

  const chunks: Document[] = [];

  for (const doc of documents) {
    const text = doc.pageContent;
    let start = 0;
    let index = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);

      chunks.push(
        new Document({
          pageContent: text.slice(start, end),
          // 继承原文档 metadata，并追加切片序号
          metadata: { ...doc.metadata, chunkIndex: index },
        })
      );

      if (end === text.length) {
        break;
      }

      start = end - chunkOverlap;
      index += 1;
    }
  }

  return chunks;
}
