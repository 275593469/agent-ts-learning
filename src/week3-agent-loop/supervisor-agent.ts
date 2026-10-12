import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { getBusinessMetricTool } from "../week2-tool-calling/tools/metrics.js";
import { listProjectsTool, getProjectDetailTool } from "../week2-tool-calling/tools/projects.js";
import { getWeatherTool } from "../week2-tool-calling/tools/weather.js";

// 学习目标：多 Agent 协作（Supervisor 模式）
// 一个「调度者」负责决定下一步交给谁，若干「专家」各自只擅长一件事（各带自己的工具）。
// 调度者可以用结构化输出做路由，让分支判断变成可校验的数据，而不是解析自然语言。
// 运行：npx tsx src/week3-agent-loop/supervisor-agent.ts

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

// ---------- 1. 三个专家：各带工具、各有自己的系统提示词 ----------

interface Expert {
  name: "energy" | "project" | "weather";
  label: string;
  systemPrompt: string;
  tools: StructuredToolInterface[];
}

const experts: Expert[] = [
  {
    name: "energy",
    label: "能耗/指标专家",
    systemPrompt: "你只负责回答园区业务指标（能耗、故障率、设备在线率）相关问题。",
    tools: [getBusinessMetricTool],
  },
  {
    name: "project",
    label: "项目交付专家",
    systemPrompt: "你只负责回答项目列表与项目详情相关问题，不回答指标与天气。",
    tools: [listProjectsTool, getProjectDetailTool],
  },
  {
    name: "weather",
    label: "天气专家",
    systemPrompt: "你只负责回答城市天气相关问题。",
    tools: [getWeatherTool],
  },
];

/** 专家内部是一个小 Agent：可以让它自己决定调几次工具 */
async function runExpert(expert: Expert, question: string): Promise<string> {
  const messages: BaseMessage[] = [
    new SystemMessage(
      `${expert.systemPrompt}\n需要数据时调用工具，禁止编造；最后用一两句话给出结论。`
    ),
    new HumanMessage(question),
  ];

  for (let step = 1; step <= 3; step++) {
    const aiMessage = await model.bindTools(expert.tools).invoke(messages);

    if (!aiMessage.tool_calls?.length) {
      return typeof aiMessage.content === "string"
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
    }

    messages.push(aiMessage);

    for (const call of aiMessage.tool_calls) {
      const target = expert.tools.find((item) => item.name === call.name);

      if (!target || !call.id) {
        continue;
      }

      try {
        messages.push(await target.invoke(call));
      } catch (error) {
        messages.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            status: "error",
            content: `执行失败：${error instanceof Error ? error.message : String(error)}`,
          })
        );
      }
    }
  }

  return "（专家未在限定轮数内给出结论）";
}

// ---------- 2. 调度者：用结构化输出做路由 ----------

const RouteSchema = z.object({
  next: z
    .enum(["energy", "project", "weather", "finish"])
    .describe("下一步交给哪个专家；信息已足够则填 finish"),
  reason: z.string().describe("做出这个决定的原因，一句话"),
});

const router = model.withStructuredOutput(RouteSchema, { name: "route_to_expert" });

const SUPERVISOR_PROMPT = `你是园区运营总控 Agent 的调度者。
可调度的专家：
- energy：园区业务指标（能耗、故障率、设备在线率）
- project：项目列表与项目详情
- weather：城市天气

规则：
1. 每次只挑一个「当前最需要」的专家，避免重复问同一个专家；
2. 已有结论能回答用户时，返回 finish；
3. 不要把专家结论直接复述，你的职责是决定下一步。`;

// ---------- 3. 用 LangGraph 把调度循环画成图 ----------

const SupervisorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  next: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "energy",
  }),
  round: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  /** 各专家给出的结论，供最终汇总使用 */
  notes: Annotation<string[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
});

const MAX_ROUNDS = 3;

async function supervisorNode(state: typeof SupervisorState.State) {
  // 超过轮数上限就强制收尾，避免调度者和专家来回鬼打墙
  if (state.round >= MAX_ROUNDS) {
    return {
      next: "finish",
      round: state.round,
      messages: [new AIMessage("已达到最大调度轮数，直接汇总现有结论。")],
    };
  }

  const transcript = state.messages
    .map((item) => `${item.getType()}: ${JSON.stringify(item.content)}`)
    .join("\n");

  const decision = await router.invoke([
    new SystemMessage(SUPERVISOR_PROMPT),
    new HumanMessage(`对话与已有结论：\n${transcript}`),
  ]);

  console.log(
    `  [supervisor] 第 ${state.round + 1} 轮 -> ${decision.next}（${decision.reason}）`
  );

  return {
    next: decision.next,
    round: state.round + 1,
    messages: [new AIMessage(`调度决策：${decision.next}｜原因：${decision.reason}`)],
  };
}

/** 动态生成专家节点 */
function makeExpertNode(expert: Expert) {
  return async (state: typeof SupervisorState.State) => {
    const lastUserMessage = state.messages
      .filter((item) => item.getType() === "human")
      .at(-1);

    const question =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : "";

    const conclusion = await runExpert(expert, question);
    console.log(`  [${expert.name}] ${conclusion.trim()}`);

    return {
      messages: [new AIMessage(`【${expert.label}】${conclusion}`)],
      notes: [conclusion],
    };
  };
}

const workflow = new StateGraph(SupervisorState)
  .addNode("supervisor", supervisorNode)
  .addNode("energy", makeExpertNode(experts[0]!))
  .addNode("project", makeExpertNode(experts[1]!))
  .addNode("weather", makeExpertNode(experts[2]!))
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", (state) => state.next, {
    energy: "energy",
    project: "project",
    weather: "weather",
    finish: END,
  })
  // 每个专家做完都回到调度者，由它决定下一步（这是 Supervisor 的核心特征）
  .addEdge("energy", "supervisor")
  .addEdge("project", "supervisor")
  .addEdge("weather", "supervisor")
  .compile();

const QUESTION =
  "本月园区能耗和故障率表现如何？顺便看看上海天气是否会影响空调负荷，以及有哪些进行中的项目。";

async function main() {
  console.log(`用户：${QUESTION}\n`);
  console.log("———— 调度过程 ————");

  const result = await workflow.invoke(
    { messages: [new HumanMessage(QUESTION)] },
    { recursionLimit: 20 }
  );

  console.log("\n================ 汇总 ================");
  const final = await model.invoke([
    new SystemMessage(
      "把下面各专家的结论汇总成给用户的一段回答：结论先行，只使用已给出的数据。"
    ),
    new HumanMessage(result.notes.map((item, index) => `${index + 1}. ${item}`).join("\n")),
  ]);

  console.log(typeof final.content === "string" ? final.content.trim() : "");

  console.log(
    "\n工程要点：\n" +
      "  · Supervisor 的价值：把「一个 Agent 什么都会」拆成「多个 Agent 各有所长」，\n" +
      "    每个专家的提示词与工具集都能单独调优、单独评测；\n" +
      "  · 路由用结构化输出（enum），比让模型输出“请交给能耗专家”这类自然语言稳得多；\n" +
      "  · 必须有轮数上限与去重策略，否则调度者会反复调用同一个专家；\n" +
      "  · 共享状态（messages/notes）通过 Annotation 声明 reducer，LangGraph 负责合并。"
  );
}

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
