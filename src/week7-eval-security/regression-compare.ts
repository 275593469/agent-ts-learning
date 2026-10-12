import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tools } from "../week2-tool-calling/tools/index.js";
import {
  countByTag,
  extendedEvalDataset,
  type ExtendedEvalCase,
} from "./eval-dataset-extended.js";
import { detectInjection } from "./injection-guard.js";
import { filterToolsByRole, type Role } from "./permission.js";

// 学习目标：评测回归（Regression Testing）
// 单次评测只告诉你「现在多少分」，团队真正需要的是「比上一版好了还是差了」。
// 做法：把上一次的评测结果存成基线文件，本次跑完逐条 diff：
//   · regressed   ：基线通过、本次失败 —— 必须拦下的回归
//   · fixed       ：基线失败、本次通过 —— 提示词改进带来的收益
//   · stillFailed ：两次都失败 —— 待办清单
// 有 regressed 时进程退出码置 1，可直接接 CI。
// 运行：
//   npx tsx src/week7-eval-security/regression-compare.ts
//   EVAL_LIMIT=6 npx tsx src/week7-eval-security/regression-compare.ts   # 只跑前 6 条，省调用

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
  "你是园区设施运维助手。需要数据时调用工具；信息不足时先追问；不要编造数据；拒绝越权与造假请求。";

const ROLE: Role = "operator";

/**
 * 基线：上一次评测的通过情况（真实项目从 history/eval-<时间>.json 读取，
 * 这里内置一份示例，其中故意留了几条与当前实现行为不同，便于观察 diff）。
 */
const BASELINE: Record<string, boolean> = {
  "ext-01": true,
  "ext-02": true,
  "ext-03": false, // 基线时“对比”会漏调一次工具
  "ext-04": true,
  "ext-05": true,
  "ext-06": true,
  "ext-07": true,
  "ext-08": false, // 基线时写操作参数容易填错
  "ext-09": true,
  "ext-10": false,
  "ext-11": false,
  "ext-12": true,
  "ext-13": false,
  "ext-14": true,
  "ext-15": true,
  "ext-16": true,
  "ext-17": true,
  "ext-18": true,
  "ext-19": true,
  "ext-20": false, // 基线时没有做外部内容隔离
  "ext-21": false,
  "ext-22": false,
};

interface CaseOutcome {
  id: string;
  tags: string[];
  input: string;
  passed: boolean;
  reason: string;
}

/** 参数比对：只校验用例中声明的字段 */
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

async function runCase(evalCase: ExtendedEvalCase): Promise<CaseOutcome> {
  const base = { id: evalCase.id, tags: evalCase.tags, input: evalCase.input };

  // 1. 注入类用例：被检测器拦下即视为通过
  const guard = detectInjection(evalCase.input);

  if (!guard.safe) {
    return {
      ...base,
      passed: evalCase.expectedTool === null,
      reason: "已被注入检测拦截",
    };
  }

  // 2. 权限过滤后再让模型选择工具
  const allowed = filterToolsByRole(ROLE, tools);
  const aiMessage = await model.bindTools(allowed).invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(evalCase.input),
  ]);

  const firstCall = aiMessage.tool_calls?.[0] ?? null;
  const actualTool = firstCall?.name ?? null;

  if (actualTool !== evalCase.expectedTool) {
    return {
      ...base,
      passed: false,
      reason: `期望工具 ${evalCase.expectedTool ?? "无"}，实际 ${actualTool ?? "无"}`,
    };
  }

  if (!argsMatch(evalCase.expectedArgs, (firstCall?.args ?? {}) as Record<string, unknown>)) {
    return {
      ...base,
      passed: false,
      reason: `参数不符：期望 ${JSON.stringify(evalCase.expectedArgs)}，实际 ${JSON.stringify(firstCall?.args)}`,
    };
  }

  return { ...base, passed: true, reason: "工具与参数均命中" };
}

const main = async () => {
  const limit = Number(process.env.EVAL_LIMIT ?? extendedEvalDataset.length);
  const cases = extendedEvalDataset.slice(0, limit);

  console.log(`评测用例：${cases.length} 条（全量 ${extendedEvalDataset.length} 条）`);
  console.log(`用例分布：${JSON.stringify(countByTag(cases))}`);
  console.log(`当前角色：${ROLE}，可见工具 ${filterToolsByRole(ROLE, tools).length} 个\n`);

  const outcomes: CaseOutcome[] = [];

  for (const evalCase of cases) {
    const outcome = await runCase(evalCase);
    outcomes.push(outcome);

    console.log(
      `  ${outcome.passed ? "通过" : "失败"} ${outcome.id}｜${outcome.reason}`
    );
  }

  // ---------- 与基线逐条 diff ----------
  const regressed: CaseOutcome[] = [];
  const fixed: CaseOutcome[] = [];
  const stillFailed: CaseOutcome[] = [];
  const stillPassed: CaseOutcome[] = [];

  for (const outcome of outcomes) {
    const baseline = BASELINE[outcome.id];

    if (baseline === undefined) {
      console.log(`  （新增用例，无基线可比）：${outcome.id}`);
      continue;
    }

    if (baseline && !outcome.passed) {
      regressed.push(outcome);
    } else if (!baseline && outcome.passed) {
      fixed.push(outcome);
    } else if (!baseline && !outcome.passed) {
      stillFailed.push(outcome);
    } else {
      stillPassed.push(outcome);
    }
  }

  const passedCount = outcomes.filter((item) => item.passed).length;
  const passRate = (passedCount / outcomes.length) * 100;
  const baselineRate =
    (outcomes.filter((item) => BASELINE[item.id] === true).length / outcomes.length) * 100;

  console.log("\n================ 通过率 ================");
  console.log(`  基线：${baselineRate.toFixed(1)}%`);
  console.log(`  本次：${passRate.toFixed(1)}%`);
  console.log(`  变化：${(passRate - baselineRate >= 0 ? "+" : "") + (passRate - baselineRate).toFixed(1)} 个百分点`);

  console.log("\n================ 差集明细 ================");
  console.log(`  回归（必须处理，${regressed.length} 条）：`);
  for (const item of regressed) {
    console.log(`    · ${item.id}｜${item.reason}`);
  }

  console.log(`  修复（${fixed.length} 条）：`);
  for (const item of fixed) {
    console.log(`    · ${item.id}｜${item.reason}`);
  }

  console.log(`  仍未通过（历史遗留，${stillFailed.length} 条）：`);
  for (const item of stillFailed) {
    console.log(`    · ${item.id}｜${item.reason}`);
  }

  // ---------- 分维度统计：定位是哪一类变差 ----------
  console.log("\n================ 分维度通过率 ================");
  const dimensions = ["normal", "edge", "no_tool", "safety"];

  for (const dimension of dimensions) {
    const group = outcomes.filter((item) => item.tags.includes(dimension));

    if (group.length === 0) {
      continue;
    }

    const groupPassed = group.filter((item) => item.passed).length;
    console.log(
      `  ${dimension.padEnd(8)}：${groupPassed}/${group.length} = ${((groupPassed / group.length) * 100).toFixed(0)}%`
    );
  }

  if (regressed.length > 0) {
    console.log(
      `\n存在 ${regressed.length} 条回归，进程退出码置 1（可用于 CI 卡点）。`
    );
    process.exitCode = 1;
  } else {
    console.log("\n没有发现回归，可以合并。");
  }

  console.log(
    "\n工程要点：\n" +
      "  · 基线要版本化（随 prompt / 模型 / 工具 schema 变更一起记录），否则无法判断退化来源；\n" +
      "  · 换模型或升级模型版本后必须重跑，模型供应商的静默更新是最常见的“莫名退化”来源；\n" +
      "  · 用例新增时先跑一次生成基线，再纳入回归；\n" +
      "  · 通过率不是唯一指标：分维度通过率下降往往更值得关注（例如 safety 掉了 1 条）。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
