import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// 学习目标：摘要记忆（Summarization Memory）
// context-history.ts 用的是「滑动窗口」：超出窗口的旧消息直接被丢掉。
// 问题是重要信息一旦滑出窗口就永远消失（“我叫小林，负责B座”）。
// 摘要记忆的做法：把要丢弃的旧消息交给模型压缩成一段摘要，保留在上下文里。
// 运行：npx tsx src/week5-memory-workflow/summary-memory.ts

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

const summarizeModel = new ChatOpenAI({
  apiKey,
  model: modelName,
  temperature: 0,
  ...(baseURL ? { configuration: { baseURL } } : {}),
});

const SYSTEM_PROMPT =
  "你是一名园区设施运维助手。回答简洁，并尽量利用已知的用户信息。";

/** 保留最近多少条消息不参与压缩 */
const KEEP_RECENT = 2;

interface SummaryMemoryState {
  summary: string;
  messages: BaseMessage[];
}

const SUMMARY_PROMPT = `把下面的对话压缩成一段简短的摘要，用于后续对话的上下文。
要求：
1. 保留用户身份、职责、关注点、明确说过的偏好与编号；
2. 保留已经得出的结论与待办事项；
3. 丢掉寒暄与重复内容；
4. 不超过 120 字，直接输出摘要文本。`;

/** 压缩：把「旧摘要 + 待压缩的旧消息」合并成新摘要 */
async function compress(
  previousSummary: string,
  toCompress: BaseMessage[]
): Promise<string> {
  const transcript = toCompress
    .map((item) => `${item.getType() === "human" ? "用户" : "助手"}：${String(item.content)}`)
    .join("\n");

  const response = await summarizeModel.invoke([
    new SystemMessage(SUMMARY_PROMPT),
    new HumanMessage(
      previousSummary
        ? `【已有摘要】\n${previousSummary}\n\n【新增对话】\n${transcript}`
        : transcript
    ),
  ]);

  return typeof response.content === "string" ? response.content.trim() : "";
}

/** 组装发送给模型的上下文：系统提示词 + 摘要 + 最近消息 */
function buildContext(state: SummaryMemoryState): BaseMessage[] {
  const messages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];

  if (state.summary) {
    messages.push(
      new SystemMessage(`【历史对话摘要】\n${state.summary}\n（摘要来自更早的对话，可能不完整）`)
    );
  }

  return [...messages, ...state.messages];
}

const state: SummaryMemoryState = { summary: "", messages: [] };

async function chat(question: string): Promise<string> {
  state.messages.push(new HumanMessage(question));

  const response = await model.invoke(buildContext(state));
  state.messages.push(new AIMessage(response.content));

  // 超出保留条数时，把多出来的旧消息压缩进摘要
  if (state.messages.length > KEEP_RECENT) {
    const overflow = state.messages.slice(0, state.messages.length - KEEP_RECENT);
    state.summary = await compress(state.summary, overflow);
    state.messages = state.messages.slice(-KEEP_RECENT);

    console.log(`  [记忆压缩] 摘要更新为：${state.summary}`);
    console.log(`  [记忆压缩] 窗口内剩余消息数：${state.messages.length}`);
  }

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

const questions = [
  "我叫小林，负责 B 座，重点关注能耗强度。",
  "B 座空调机组的巡检周期是多久？",
  "顺便说一句，我的工单编号前缀是 WO-2024。",
  "刚才我说过我的工单前缀吗？如果记得，请重复。",
  "我负责哪个楼栋？关注的指标是什么？",
];

const main = async () => {
  console.log(`保留策略：最近 ${KEEP_RECENT} 条消息不压缩，其余压缩进摘要\n`);

  for (const [index, question] of questions.entries()) {
    console.log(`\n第 ${index + 1} 轮`);
    console.log(`用户：${question}`);
    console.log(`助手：${await chat(question)}`);
  }

  console.log("\n================ 最终记忆状态 ================");
  console.log(`摘要：${state.summary || "（无）"}`);
  console.log(`窗口内消息数：${state.messages.length}`);

  console.log(
    "\n工程要点：\n" +
      "  · 摘要是有损压缩，越压越糊；关键事实（编号、权限、金额）应单独结构化存储，\n" +
      "    而不是只依赖摘要（见 long-term-memory.ts 的做法）；\n" +
      "  · 压缩时机可以按条数、按 token 数，也可以按“主题切换”触发；\n" +
      "  · 摘要本身也要限制长度，否则它会成为新的上下文膨胀源；\n" +
      "  · 生产上摘要应异步执行（不阻塞当前回答），并落库随会话持久化。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
