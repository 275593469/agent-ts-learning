import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// 学习目标：状态持久化（Checkpoint Persistence）
// conversation-memory.ts 用的是 MemorySaver：进程一重启，所有会话就没了。
// 生产环境必须落到外部存储（Postgres / SQLite / Redis），才能做到：
//   · 服务滚动发布不丢会话
//   · 多实例共享同一份会话状态
//   · 支持断点续跑与人工介入
// 这里用文件模拟一个持久化存储，把「存 -> 重启 -> 读 -> 继续」的闭环跑通。
// 运行：
//   npx tsx src/week5-memory-workflow/persistent-checkpoint.ts          # 第一次：新会话
//   npx tsx src/week5-memory-workflow/persistent-checkpoint.ts --resume # 模拟重启后恢复
//   npx tsx src/week5-memory-workflow/persistent-checkpoint.ts --reset  # 清空存储

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
const baseURL = process.env.OPENAI_BASE_URL;

if (!apiKey || !modelName) {
  throw new Error("请检查 .env 中的模型配置");
}

const model = new ChatOpenAI({
  apiKey,
  model: modelName,
  temperature: 0.3,
  ...(baseURL ? { configuration: { baseURL } } : {}),
});

// ---------- 1. 存储层：接口先定下来，换实现时业务代码不动 ----------

interface StoredMessage {
  role: "human" | "ai";
  content: string;
  at: string;
}

interface SessionRecord {
  threadId: string;
  updatedAt: string;
  messages: StoredMessage[];
}

interface CheckpointStore {
  load(threadId: string): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
  remove(threadId: string): Promise<void>;
}

const STORE_DIR = path.resolve(process.cwd(), ".memory", "checkpoints");

/** 文件实现：一个 thread 一个 JSON 文件（够教学，生产请换数据库） */
class FileCheckpointStore implements CheckpointStore {
  private fileOf(threadId: string): string {
    return path.join(STORE_DIR, `${threadId}.json`);
  }

  async load(threadId: string): Promise<SessionRecord | null> {
    try {
      const content = await fs.readFile(this.fileOf(threadId), "utf-8");
      return JSON.parse(content) as SessionRecord;
    } catch {
      return null;
    }
  }

  async save(record: SessionRecord): Promise<void> {
    await fs.mkdir(STORE_DIR, { recursive: true });
    await fs.writeFile(this.fileOf(record.threadId), JSON.stringify(record, null, 2), "utf-8");
  }

  async remove(threadId: string): Promise<void> {
    await fs.rm(this.fileOf(threadId), { force: true });
  }
}

const store: CheckpointStore = new FileCheckpointStore();

// ---------- 2. 会话服务：读取 -> 追加 -> 回答 -> 回写 ----------

function toMessages(record: SessionRecord | null): BaseMessage[] {
  if (!record) {
    return [];
  }

  return record.messages.map((item) =>
    item.role === "human" ? new HumanMessage(item.content) : new AIMessage(item.content)
  );
}

async function chat(threadId: string, question: string): Promise<string> {
  const record = await store.load(threadId);
  const history = toMessages(record);

  console.log(
    `  [存储] thread=${threadId} 恢复历史消息 ${history.length} 条` +
      (record ? `（最后更新：${record.updatedAt}）` : "（新会话）")
  );

  const response = await model.invoke([
    new SystemMessage("你是一名园区设施运维助手，回答简洁，并结合已恢复的历史信息。"),
    ...history,
    new HumanMessage(question),
  ]);

  const answer =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  // 回写：把本轮问答追加到持久化记录
  const nextRecord: SessionRecord = {
    threadId,
    updatedAt: new Date().toISOString(),
    messages: [
      ...(record?.messages ?? []),
      { role: "human", content: question, at: new Date().toISOString() },
      { role: "ai", content: answer, at: new Date().toISOString() },
    ],
  };

  await store.save(nextRecord);
  console.log(`  [存储] 已写入，累计消息 ${nextRecord.messages.length} 条`);

  return answer;
}

// ---------- 3. 入口：模拟两次启动 ----------

const THREAD_ID = "thread-persist-001";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--reset")) {
    await store.remove(THREAD_ID);
    console.log(`已清空 ${THREAD_ID} 的检查点`);
    return;
  }

  if (args.includes("--resume")) {
    console.log("模拟服务重启后继续对话（历史来自磁盘）\n");
    console.log("用户：我叫什么？负责哪个楼栋？");
    console.log("助手：", (await chat(THREAD_ID, "我叫什么？负责哪个楼栋？")).trim());
    return;
  }

  console.log("第一次启动：写入会话状态\n");
  console.log("用户：我叫小林，负责 B 座。");
  console.log("助手：", (await chat(THREAD_ID, "我叫小林，负责 B 座。")).trim());

  console.log("\n用户：B 座空调机组的巡检周期是多久？");
  console.log("助手：", (await chat(THREAD_ID, "B 座空调机组的巡检周期是多久？")).trim());

  console.log(
    `\n状态已落盘：${path.join(STORE_DIR, `${THREAD_ID}.json`)}\n` +
      "现在重新执行一次即可验证恢复能力：\n" +
      "  npx tsx src/week5-memory-workflow/persistent-checkpoint.ts --resume\n" +
      "清理：\n" +
      "  npx tsx src/week5-memory-workflow/persistent-checkpoint.ts --reset"
  );
}

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
