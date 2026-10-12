import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tools } from "../week2-tool-calling/tools/index.js";

// 工具数组由不同类型的工具组成，用统一接口 + 名字索引，后续调用就不必反复做类型收窄
const toolMap = new Map<string, StructuredToolInterface>(
  tools.map((item) => [item.name, item])
);

// 学习目标：手写 ReAct 循环（不依赖 LangGraph）
// agent-graph.ts 用框架把「模型 -> 工具 -> 模型」的循环封装成了图。
// 这里把框架拆掉，用最朴素的 while + 文本解析实现一遍，
// 目的是看清 Agent 循环的本质：提示词约定格式 → 解析动作 → 执行 → 把结果追加回上下文。
// 运行：npx tsx src/week3-agent-loop/react-from-scratch.ts

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

// ---------- 1. 把工具清单渲染进提示词 ----------

function renderTools(): string {
  return [...toolMap.values()]
    .map((item) => `- ${item.name}：${item.description}`)
    .join("\n");
}

const REACT_SYSTEM = `你是一个可以调用工具的智能助手。可用工具：
${renderTools()}

请严格按下面的格式思考与行动，每次只输出一步：

Thought: 你的推理过程（一句话）
Action: 工具名，必须是上面列表中的一个
Action Input: 工具入参的 JSON，例如 {"area": "A座"}

当你已经收集到足够信息时，改用下面的格式结束：

Thought: 我已经可以回答了
Final Answer: 给用户的最终回答

注意：不要臆造工具返回的数据，一切结论都要基于 Observation。`;

// ---------- 2. 解析模型输出 ----------

interface ParsedStep {
  thought: string;
  finalAnswer: string | null;
  action: string | null;
  actionInput: Record<string, unknown>;
}

function parseStep(text: string): ParsedStep {
  const thought = /Thought[:：]\s*([\s\S]*?)(?=\n(?:Action|Final Answer)[:：]|$)/.exec(text);
  const finalAnswer = /Final Answer[:：]\s*([\s\S]*)$/.exec(text);
  const action = /Action[:：]\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
  const actionInput = /Action Input[:：]\s*(\{[\s\S]*?\})/.exec(text);

  let input: Record<string, unknown> = {};
  if (actionInput?.[1]) {
    try {
      input = JSON.parse(actionInput[1]) as Record<string, unknown>;
    } catch {
      input = {};
    }
  }

  return {
    thought: (thought?.[1] ?? "").trim(),
    finalAnswer: finalAnswer?.[1] ? finalAnswer[1].trim() : null,
    action: action?.[1] ?? null,
    actionInput: input,
  };
}

/** 执行一步工具调用，异常也转成可读的 Observation */
async function executeAction(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const target = toolMap.get(name);

  if (!target) {
    return `错误：不存在名为 ${name} 的工具，请从工具列表中选择。`;
  }

  try {
    const result = await target.invoke(input as never);
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (error) {
    return `工具执行失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

// ---------- 3. 主循环：这就是 Agent 的全部 ----------

const MAX_STEPS = 6;

async function react(question: string): Promise<string> {
  // 上下文 = 系统提示词 + 问题 + 累积的 Thought/Action/Observation 文本
  let scratchpad = "";

  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await model.invoke([
      new SystemMessage(REACT_SYSTEM),
      new HumanMessage(`问题：${question}\n\n${scratchpad}`),
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const parsed = parseStep(text);

    if (parsed.thought) {
      console.log(`  [step ${step}] Thought: ${parsed.thought}`);
    }

    // 终止条件：模型给出最终答案
    if (parsed.finalAnswer) {
      return parsed.finalAnswer;
    }

    if (!parsed.action) {
      // 模型没按格式输出，兜底把它当作最终答案，避免死循环
      console.log(`  [step ${step}] 未解析到 Action，直接作为回答返回`);
      return text.trim();
    }

    console.log(
      `  [step ${step}] Action: ${parsed.action} 入参=${JSON.stringify(parsed.actionInput)}`
    );

    const observation = await executeAction(parsed.action, parsed.actionInput);
    console.log(`  [step ${step}] Observation: ${observation.slice(0, 120)}`);

    // 把本轮轨迹追加进 scratchpad，作为下一轮的输入
    scratchpad += `${text.trim()}\nObservation: ${observation}\n\n`;
  }

  return "（达到最大步数仍未得出最终答案）";
}

const questions = [
  "A座有多少台设备？其中几台是异常的？",
  "对比本月和上月的故障率，说明变好了还是变差了。",
];

const main = async () => {
  for (const question of questions) {
    console.log(`\n================ 问题：${question} ================`);
    const answer = await react(question);
    console.log("\nFinal Answer：");
    console.log(answer);
  }

  console.log(
    "\n对比框架版（agent-graph.ts）：\n" +
      "  · 手写版：循环、解析、终止条件都显式可见，调试方便，但格式解析脆弱、\n" +
      "    每次要把整个 scratchpad 重新发一遍（token 随步数线性增长）；\n" +
      "  · 框架版（LangGraph + 原生 tool_calls）：由协议保证结构化，失败重试更稳，\n" +
      "    状态由 checkpointer 管理，适合上生产。\n" +
      "  建议：先用原生 tool_calls，遇到「需要自定义状态机 / 多节点协作」再上 LangGraph。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
