import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tools } from "../week2-tool-calling/tools/index.js";
import { evalDataset, type EvalCase } from "./eval-dataset.js";
import { detectInjection } from "./injection-guard.js";
import { assertToolAllowed, filterToolsByRole, type Role } from "./permission.js";
import { TokenBudget } from "./token-budget.js";
import { TraceLogger } from "./trace-logger.js";

// 运行：npx tsx src/week7-eval-security/eval-runner.ts
// 把第 7 周的评估、安全、性能串成一条流水线：
// 注入检测 -> 权限过滤 -> 工具调用 -> 准确率统计 -> Token 预算 -> 轨迹输出

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

const SYSTEM_PROMPT =
  "你是一名企业数据助手。需要数据时调用工具；不需要工具时直接回答。不要编造数据。";

interface CaseResult {
  id: string;
  input: string;
  actualTool: string | null;
  toolMatched: boolean;
  argsMatched: boolean;
  blocked: boolean;
}

/** 校验期望参数是否都被满足（只比对本用例声明的字段） */
function argsMatch(
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown>
): boolean {
  if (!expected) {
    return true;
  }

  return Object.entries(expected).every(([key, value]) => {
    const actualValue = actual[key];
    return (
      typeof actualValue === "string" &&
      typeof value === "string" &&
      actualValue.includes(value)
    );
  });
}

async function runCase(
  evalCase: EvalCase,
  role: Role,
  trace: TraceLogger,
  budget: TokenBudget
): Promise<CaseResult> {
  budget.consume(evalCase.input);

  // 1. 注入检测
  const guard = detectInjection(evalCase.input);

  if (!guard.safe) {
    trace.log("guard", `guard:${evalCase.id}`, `拦截注入：${guard.matched.join(", ")}`);
    return {
      id: evalCase.id,
      input: evalCase.input,
      actualTool: null,
      toolMatched: evalCase.expectedTool === null,
      argsMatched: true,
      blocked: true,
    };
  }

  // 2. 按角色过滤工具（从源头裁剪可见工具）
  const allowedTools = filterToolsByRole(role, tools);

  // 3. 让模型做工具选择
  const aiMessage = await trace.time("model", `select-tool:${evalCase.id}`, () =>
    model.bindTools(allowedTools).invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(evalCase.input),
    ])
  );

  const firstCall = aiMessage.tool_calls?.[0] ?? null;
  const actualTool = firstCall?.name ?? null;

  if (firstCall) {
    // 4. 执行前硬校验，双保险
    assertToolAllowed(role, firstCall.name);
    trace.log("tool", `plan:${evalCase.id}`, `计划调用 ${firstCall.name}`);
  }

  return {
    id: evalCase.id,
    input: evalCase.input,
    actualTool,
    toolMatched: actualTool === evalCase.expectedTool,
    argsMatched: argsMatch(evalCase.expectedArgs, (firstCall?.args ?? {}) as Record<string, unknown>),
    blocked: false,
  };
}

const main = async () => {
  const trace = new TraceLogger(`eval-${Date.now()}`);
  const budget = new TokenBudget(2000);

  // 分别用不同角色跑一遍，admin 拥有全部权限
  const role: Role = "admin";
  console.log(`评估角色：${role}，可见工具：${filterToolsByRole(role, tools).map((t) => t.name).join(", ")}`);

  const results: CaseResult[] = [];

  for (const evalCase of evalDataset) {
    const result = await runCase(evalCase, role, trace, budget);
    results.push(result);

    const flag = result.blocked ? "已拦截" : result.toolMatched ? "命中" : "未命中";
    console.log(
      `  ${result.id} [${flag}] 期望工具=${evalCase.expectedTool ?? "无"} 实际工具=${result.actualTool ?? "无"}`
    );
  }

  const total = results.length;
  const toolHits = results.filter((item) => item.toolMatched).length;
  const argHits = results.filter((item) => item.argsMatched).length;

  console.log("\n评估结果：");
  console.log(`  工具调用准确率：${toolHits}/${total} = ${((toolHits / total) * 100).toFixed(1)}%`);
  console.log(`  参数准确率：  ${argHits}/${total} = ${((argHits / total) * 100).toFixed(1)}%`);

  // 越权场景：viewer 尝试调用写工具
  console.log("\n越权场景测试：");
  try {
    assertToolAllowed("viewer", "update_device_status");
  } catch (error) {
    console.log("  通过 —", error instanceof Error ? error.message : String(error));
  }

  trace.log("finish", "eval", `toolAcc=${((toolHits / total) * 100).toFixed(1)}%`);
  trace.print();
  console.log("\nToken 预算：", budget.snapshot());
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
