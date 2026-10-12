import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tools } from "./tools/index.js";

// 学习目标：并行工具调用（Parallel Tool Calling）
// 一句话里包含多个互不依赖的诉求时，模型会一次返回多个 tool_calls。
// 这些调用没有先后关系，串行执行纯属浪费——用 Promise.all 并发能显著降低总耗时。
// 关键约束：每个结果必须绑定对应的 tool_call_id，否则模型无法把结果与请求对上。
// 运行：npx tsx src/week2-tool-calling/parallel-tools.ts

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

const modelWithTools = model.bindTools(tools);

const toolMap = new Map<string, StructuredToolInterface>(
  tools.map((item) => [item.name, item])
);

const SYSTEM_PROMPT = `你是一名园区运营数据助手。
需要数据时必须调用工具，禁止凭记忆回答；一次可以并行调用多个互不相关的工具。`;

/** 串行执行：一个接一个 await，总耗时 = 各工具耗时之和 */
async function runSerial(calls: { id?: string; name: string; args: unknown }[]) {
  const start = Date.now();
  const results: ToolMessage[] = [];

  for (const call of calls) {
    const target = toolMap.get(call.name);
    if (!target || !call.id) {
      continue;
    }
    results.push(await target.invoke(call as never));
  }

  return { results, elapsed: Date.now() - start };
}

/** 并行执行：同时发起，总耗时 ≈ 最慢的那个工具 */
async function runParallel(calls: { id?: string; name: string; args: unknown }[]) {
  const start = Date.now();

  const results = await Promise.all(
    calls.map((call) => {
      const target = toolMap.get(call.name);
      if (!target || !call.id) {
        return Promise.resolve(null);
      }
      return target.invoke(call as never);
    })
  );

  return {
    results: results.filter((item): item is ToolMessage => item !== null),
    elapsed: Date.now() - start,
  };
}

const QUESTION =
  "帮我同时看一下：北京今天的天气、当前进行中的项目、以及本月和上月的设备在线率。";

const main = async () => {
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(QUESTION),
  ];

  console.log(`用户：${QUESTION}\n`);

  // 第 1 次调用：模型规划出若干工具调用
  const plan = await modelWithTools.invoke(messages);
  const calls = plan.tool_calls ?? [];

  console.log(`模型规划出 ${calls.length} 个工具调用：`);
  for (const call of calls) {
    console.log(`  · ${call.name} 参数=${JSON.stringify(call.args)}`);
  }

  if (calls.length === 0) {
    console.log("模型没有请求工具，直接回答：", plan.content);
    return;
  }

  // 对比两种执行方式
  const serial = await runSerial(calls);
  const parallel = await runParallel(calls);

  console.log("\n执行耗时对比：");
  console.log(`  串行：${serial.elapsed}ms`);
  console.log(`  并行：${parallel.elapsed}ms`);

  // 用并行结果继续对话
  messages.push(plan, ...parallel.results);

  const finalMessage = await model.invoke(messages);
  console.log("\n最终回答：");
  console.log(
    typeof finalMessage.content === "string"
      ? finalMessage.content
      : JSON.stringify(finalMessage.content)
  );

  console.log(
    "\n工程要点：\n" +
      "  1. 并行只适用于「互不依赖」的调用；如果第二个工具的参数依赖第一个的结果，只能串行；\n" +
      "  2. 全量并行时某个工具失败会导致 Promise.all 整体 reject ——\n" +
      "     生产环境用 Promise.allSettled，把失败项转成 status=error 的 ToolMessage 回传模型；\n" +
      "  3. 并发数要设上限（如 5），避免一次性打爆下游接口。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
