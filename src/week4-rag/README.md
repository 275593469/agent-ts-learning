# 第 4 周：RAG 知识库

## 学习内容
文档解析、切片、Embedding、向量检索、混合检索、Reranking、引用溯源。

## 文件说明

| 文件 | 知识点 |
| --- | --- |
| `documents.ts` | 文档解析（含 `metadata.source`，为引用溯源做准备） |
| `splitter.ts` | 文档切片：固定窗口 + overlap，保留 metadata |
| `embedding.ts` | Embedding 工厂 + 余弦相似度 |
| `embedding-demo.ts` | 直观感受“语义相近 → 相似度高” |
| `retriever.ts` | 内存向量库 + 关键词检索 + RRF 混合检索 + Reranking |
| `rag-agent.ts` | 端到端：切片 → 建索引 → 检索 → 带引用回答 |
| `chunking-strategies.ts` | 三种切片策略对比：固定窗口 / 按结构 / 句子+合并 |
| `bm25.ts` | 手写 BM25：IDF + 词频饱和 + 长度归一，并与纯词频打分对照 |
| `query-rewrite.ts` | 查询改写（keywords / synonyms / expanded）+ 多路召回 RRF 合并 |
| `rerank-demo.ts` | 重排：召回 Top5 后逐片打分，观察排序变化 |

## 运行

```bash
npx tsx src/week4-rag/embedding-demo.ts
npm run week4:rag
npm run week4:chunking   # 纯本地，无需模型
npm run week4:bm25       # 纯本地，无需模型
npm run week4:rewrite
npm run week4:rerank
```

## 说明
`@langchain/core` v1 已移除 `MemoryVectorStore`，因此这里手写内存向量库，
优点是把「混合检索（RRF）」和「重排（Reranking）」的评分逻辑完整暴露出来。
生产环境可替换为 PGVector / Milvus / Elasticsearch 等。

若你的模型网关不提供 embedding 接口（会出现 `MODEL_NOT_FOUND` / 404），
本目录会自动降级为**本地哈希向量**继续跑通流程；
也可以显式指定 `USE_LOCAL_EMBEDDING=true` 强制使用本地实现。

## 本周成果
上传业务文档和技术手册后，能按资料回答问题并标注来源编号的 Agent（`rag-agent.ts`）。
