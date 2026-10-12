import "dotenv/config";
import { createEmbeddings, createLocalEmbeddings, cosineSimilarity, type EmbeddingModel } from "./embedding.js";

// 运行：npx tsx src/week4-rag/embedding-demo.ts
// 观察：语义相近的两句话相似度明显高于语义无关的两句话。

async function pickEmbeddings(): Promise<{ model: EmbeddingModel; name: string }> {
  if (process.env.USE_LOCAL_EMBEDDING === "true") {
    return { model: createLocalEmbeddings(), name: "本地哈希向量" };
  }

  try {
    const model = createEmbeddings();
    // 先做一次探测调用，确认服务可用
    await model.embedQuery("探测");
    return { model, name: `在线 Embedding（${process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"}）` };
  } catch {
    console.warn("在线 Embedding 不可用，降级为本地哈希向量\n");
    return { model: createLocalEmbeddings(), name: "本地哈希向量" };
  }
}

const main = async () => {
  const { model: embeddings, name } = await pickEmbeddings();

  const sentences = [
    "空调机组检修前必须断电挂牌上锁，严禁带电作业。", // 基准句
    "检修空调要先断电上锁，不能带电操作。", // 语义相近
    "本月园区用电量为 128.6 万千瓦时。", // 语义无关
  ];

  const vectors = await embeddings.embedDocuments(sentences);
  const base = vectors[0]!;

  console.log(`向量模型：${name}，向量维度：${base.length}\n`);

  for (let i = 0; i < sentences.length; i++) {
    const vector = vectors[i]!;
    const score = cosineSimilarity(base, vector);
    console.log(`相似度 ${score.toFixed(4)}  ${sentences[i]}`);
  }
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
