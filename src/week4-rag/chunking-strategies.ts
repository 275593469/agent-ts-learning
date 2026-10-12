import { Document } from "@langchain/core/documents";
import { rawDocuments } from "./documents.js";
import { splitDocuments } from "./splitter.js";

// 学习目标：切片策略对比（Chunking Strategies）
// 切片是 RAG 里最容易被忽略、又最影响效果的一步：
//   · 固定窗口：实现最简单，可能从句子中间切断
//   · 按结构切：尊重标题/段落/条款，语义完整，长度不均
//   · 句子 + 合并：先切句再合并到目标长度，兼顾完整与均匀
// 这里不做「哪个更好」的结论，而是把同一批文档用三种方式切出来，直接看差异。
// 运行：npx tsx src/week4-rag/chunking-strategies.ts

// ---------- 策略 1：固定窗口 + 重叠（沿用 splitter.ts） ----------
function fixedWindow(documents: Document[], chunkSize: number, overlap: number): Document[] {
  return splitDocuments(documents, { chunkSize, chunkOverlap: overlap });
}

// ---------- 策略 2：按结构切（标题 / 段落） ----------

/** 以「一、二、三」或 Markdown 标题作为分隔点，把长文档切成若干条款 */
function structural(documents: Document[]): Document[] {
  const chunks: Document[] = [];

  for (const doc of documents) {
    const title = doc.pageContent.split("\n")[0] ?? "未命名";

    // 以「一、」这类序号开头的位置作为切分点；没有序号则按空行切段
    const parts = doc.pageContent
      .split(/\n(?=[一二三四五六七八九十]+、)|(?=\n\s*\n)/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    parts.forEach((part, index) => {
      chunks.push(
        new Document({
          pageContent: part,
          metadata: {
            ...doc.metadata,
            chunkIndex: index,
            // 结构切片的最大好处：每片都带着所属文档标题，检索时可作为上下文提示
            sectionTitle: title,
          },
        })
      );
    });
  }

  return chunks;
}

// ---------- 策略 3：句子 + 合并到目标长度 ----------

/** 中文按句末标点切句 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；])/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function sentenceMerged(documents: Document[], targetSize: number): Document[] {
  const chunks: Document[] = [];

  for (const doc of documents) {
    const sentences = splitSentences(doc.pageContent);
    let buffer: string[] = [];
    let index = 0;

    const flush = () => {
      if (buffer.length === 0) {
        return;
      }

      chunks.push(
        new Document({
          pageContent: buffer.join(""),
          metadata: { ...doc.metadata, chunkIndex: index, strategy: "sentence" },
        })
      );

      // 保留最后一句作为下一片的开头，形成句子级 overlap
      buffer = buffer.slice(-1);
      index += 1;
    };

    for (const sentence of sentences) {
      const candidate = [...buffer, sentence].join("");

      if (candidate.length > targetSize && buffer.length > 1) {
        flush();
      }

      buffer.push(sentence);
    }

    if (buffer.length > 0) {
      buffer.pop(); // 去掉被 overlap 复制的那一句，避免重复
      if (buffer.length > 0) {
        chunks.push(
          new Document({
            pageContent: buffer.join(""),
            metadata: { ...doc.metadata, chunkIndex: index, strategy: "sentence" },
          })
        );
      }
    }
  }

  return chunks;
}

// ---------- 统计与对比 ----------

interface ChunkStats {
  name: string;
  count: number;
  avgLength: number;
  minLength: number;
  maxLength: number;
  /** 以句末标点结尾的比例：越高说明越不容易「切断句子」 */
  sentenceEndRate: string;
}

function statsOf(name: string, chunks: Document[]): ChunkStats {
  const lengths = chunks.map((item) => item.pageContent.length);
  const wellEnded = chunks.filter((item) => /[。！？；]$/.test(item.pageContent.trim())).length;

  return {
    name,
    count: chunks.length,
    avgLength: Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length),
    minLength: Math.min(...lengths),
    maxLength: Math.max(...lengths),
    sentenceEndRate: `${((wellEnded / chunks.length) * 100).toFixed(0)}%`,
  };
}

const strategies: { name: string; note: string; chunks: Document[] }[] = [
  {
    name: "固定窗口（size=140, overlap=40)",
    note: "长度均匀、实现最简；可能从句子中间切断",
    chunks: fixedWindow(rawDocuments, 140, 40),
  },
  {
    name: "按结构切（条款 / 段落）",
    note: "语义完整、天然带小标题；长度不均，短条款多",
    chunks: structural(rawDocuments),
  },
  {
    name: "句子 + 合并（target=180）",
    note: "不切断句子，长度也相对可控；实现最复杂",
    chunks: sentenceMerged(rawDocuments, 180),
  },
];

const main = () => {
  console.log(`原始文档：${rawDocuments.length} 篇\n`);

  const allStats = strategies.map((item) => statsOf(item.name, item.chunks));

  console.log("================ 切片统计 ================");
  for (const [index, stat] of allStats.entries()) {
    console.log(`\n${stat.name}`);
    console.log(`  说明：${strategies[index]!.note}`);
    console.log(`  切片数：${stat.count}`);
    console.log(`  平均长度：${stat.avgLength} 字符（最短 ${stat.minLength} / 最长 ${stat.maxLength}）`);
    console.log(`  以句末标点结尾的比例：${stat.sentenceEndRate}`);
  }

  // 挑一篇文档，直接展示三种策略切出来的边界差异
  const sampleTitle = "空调机组维护作业安全要求";
  console.log(`\n================ 边界对比（文档：${sampleTitle}） ================`);

  for (const strategy of strategies) {
    const hit = strategy.chunks.find((item) => item.pageContent.includes("作业前必须完成三项确认"));
    console.log(`\n[${strategy.name}]`);
    console.log(`  ${hit ? hit.pageContent.replace(/\n/g, " / ") : "（该策略下未单独成片）"}`);
  }

  console.log(
    "\n结论与实践建议：\n" +
      "  1. 政策、规范、操作手册类文档优先「按结构切」，因为答案常常就是一整条；\n" +
      "  2. 长文/散文类内容用「句子 + 合并」，避免把一句话劈成两半；\n" +
      "  3. 无论哪种策略，都要保留 metadata（来源、章节标题、chunkIndex），\n" +
      "     引用溯源、上下文补全、去重都依赖它；\n" +
      "  4. 切片参数没有普适最优解 —— 用第 7 周的评估集量「召回命中率」来选。"
  );
};

main();
