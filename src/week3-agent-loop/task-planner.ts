import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tools } from "../week2-tool-calling/tools/index.js";

// 统一成同一接口，方便按名字查找与动态挑选
const allTools: StructuredToolInterface[] = tools;

// 学习目标：规划-执行（Plan-and-Execute）
// 复杂目标一次性让模型边想边做，容易漏步骤。拆成两阶段更稳：
//   阶段 1 规划：只产出「子任务清单」（结构化输出，可用性更高）
//   阶段 2 执行：逐个执行子任务，把已完成任务的结论作为下一任务的上下文
// 与 agent-graph.ts 的区别：那里是「边做边想」（ReAct），这里是「先想好再做」（Plan）。
// 运行：npx tsx src/week3-agent-loop/task-planner.ts

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

// ---------- 阶段 1：产出计划 ----------

const PlanSchema = z.object({
  goal: z.string().describe("用一句话复述目标"),
  steps: z
    .array(
      z.object({
        id: z.number().describe("步骤序号，从 1 开始"),
        task: z.string().describe("这一步要做什么，要具体到可执行"),
        tools: z
          .array(z.string())
          .describe(`需要的工具名，只能从这些里选：${tools.map((t) => t.name).join(", ")}`),
        output: z.string().describe("这一步的产出物，用于后续步骤引用"),
      })
    )
    .min(1)
    .describe("子任务清单，按执行顺序排列"),
});

type Plan = z.infer<typeof PlanSchema>;

const planner = model.withStructuredOutput(PlanSchema, { name: "make_plan" });

const PLANNER_PROMPT = `你是园区运营 Agent 的任务规划器。
把用户目标拆成 2~4 个有明确产出的子任务：
1. 每个子任务只做一件事，且能用工具拿到数据；
2. 能并行的不要强行拆成串行；
3. 不要规划出「等待用户确认」这类无法自动执行的步骤。`;

// ---------- 阶段 2：执行单个子任务（内部是一个小 Agent 循环） ----------

const EXECUTOR_PROMPT = `你是园区运营 Agent 的执行器。
1. 只完成当前这一个子任务，不要越界做别的；
2. 需要数据时调用工具，工具返回什么就说什么，不要编造；
3. 输出格式：【结论】一句话 + 【依据】引用的数据。`;

const toolMap = new Map(allTools.map((item) => [item.name, item]));

async function executeStep(
  task: string,
  context: string,
  allowedTools: string[]
): Promise<string> {
  const visible = allTools.filter((item) => allowedTools.includes(item.name));
  const usable = visible.length > 0 ? visible : allTools;

  const messages: BaseMessage[] = [
    new SystemMessage(EXECUTOR_PROMPT),
    new HumanMessage(
      `已完成任务的结论：\n${context || "（无）"}\n\n当前子任务：${task}`
    ),
  ];

  for (let step = 1; step <= 4; step++) {
    const aiMessage = await model.bindTools(usable).invoke(messages);

    if (!aiMessage.tool_calls?.length) {
      return typeof aiMessage.content === "string"
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
    }

    messages.push(aiMessage);

    for (const call of aiMessage.tool_calls) {
      if (!call.id) {
        continue;
      }

      const target = toolMap.get(call.name);

      if (!target) {
        messages.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            status: "error",
            content: `未知工具：${call.name}`,
          })
        );
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

  return "（该子任务超过最大工具调用轮数仍未完成）";
}

// ---------- 编排：规划 -> 逐步执行 -> 汇总 ----------

const GOAL =
  "评估园区本月运行状况：能耗与故障率是否正常、有哪些进行中的交付项目需要关注，输出一段结论。";

async function main() {
  console.log(`目标：${GOAL}\n`);

  // 1. 规划
  const plan: Plan = await planner.invoke([
    new SystemMessage(PLANNER_PROMPT),
    new HumanMessage(GOAL),
  ]);

  console.log("================ 计划 ================");
  console.log(`目标复述：${plan.goal}`);
  for (const step of plan.steps) {
    console.log(`  ${step.id}. ${step.task}`);
    console.log(`     工具=${step.tools.join(", ") || "无"}；产出=${step.output}`);
  }

  // 2. 逐步执行，把上一步的产出带进下一步
  console.log("\n================ 执行 ================");
  const results: string[] = [];

  for (const step of plan.steps) {
    const context = results
      .map((item, index) => `步骤 ${index + 1}：${item}`)
      .join("\n");

    console.log(`\n[步骤 ${step.id}] ${step.task}`);
    const conclusion = await executeStep(step.task, context, step.tools);
    results.push(conclusion);
    console.log(conclusion.trim());
  }

  // 3. 汇总成最终交付
  const summary = await model.invoke([
    new SystemMessage(
      "你负责把多步执行结果汇总成给管理层的简报：结论先行，只引用已提供的数据，不要新增事实。"
    ),
    new HumanMessage(
      `原始目标：${GOAL}\n\n各步骤结果：\n${results
        .map((item, index) => `${index + 1}. ${item}`)
        .join("\n")}`
    ),
  ]);

  console.log("\n================ 最终简报 ================");
  console.log(typeof summary.content === "string" ? summary.content.trim() : "");

  console.log(
    "\n工程要点：\n" +
      "  · 规划阶段用结构化输出，计划本身就是可校验、可展示、可人工修改的数据；\n" +
      "  · 执行阶段每步只给「它需要的工具」，减少误用；\n" +
      "  · 步骤之间靠「上下文摘要」传递，不是把全部历史都带过去；\n" +
      "  · 生产上要做：步骤超时、失败重试、断点续跑（把计划与结果落库）。"
  );
}

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
