import "dotenv/config";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 学习目标：结构化输出（原生能力 vs 手写解析）
// structured-output.ts 里我们让模型「输出 JSON 字符串」，然后自己 JSON.parse + Zod 校验。
// 这里用 ChatOpenAI.withStructuredOutput：由框架负责把 schema 转成 tool/JSON 模式，
// 并在返回时做一次校验，业务代码直接拿到类型安全的对象。
// 运行：npx tsx src/week1-llm-basics/structured-output-native.ts

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

// 1. 用 Zod 描述业务数据结构（与手写方案共用同一份 schema 思路）
const WorkOrderSchema = z.object({
  deviceId: z.string().describe("设备编号，例如 D002"),
  faultType: z
    .enum(["电梯困人", "空调漏水", "门禁失效", "通讯中断", "其他"])
    .describe("故障类型"),
  urgency: z.enum(["低", "中", "高"]).describe("紧急程度"),
  assignee: z.string().describe("建议派单给谁，例如 电梯维保组"),
  actions: z.array(z.string()).describe("现场处置步骤，按顺序排列"),
});

type WorkOrder = z.infer<typeof WorkOrderSchema>;

// 2. 结构化链：不用自己写解析与重试
const structuredModel = model.withStructuredOutput(WorkOrderSchema, {
  name: "create_work_order",
});

const REPORT =
  "B座 3 号电梯在 14:20 左右突然停在 8 楼与 9 楼之间，轿厢内有人，门无法打开；" +
  "同时监控发现电梯机房温度偏高。";

const PROMPT = `你是园区设施运维调度助手。请根据现场描述生成一张工单。`;

const main = async () => {
  console.log("现场描述：");
  console.log(REPORT);

  const workOrder: WorkOrder = await structuredModel.invoke([
    new SystemMessage(PROMPT),
    new HumanMessage(REPORT),
  ]);

  console.log("\n结构化结果（已是类型安全的对象，无需 JSON.parse）：");
  console.log(JSON.stringify(workOrder, null, 2));

  // 3. 拿到的对象可以直接参与业务逻辑，例如按紧急程度路由
  const route =
    workOrder.urgency === "高" ? "立即电话通知值班经理" : "进入常规工单池";

  console.log("\n派单路由：");
  console.log(`  紧急程度 ${workOrder.urgency} -> ${route}`);
  console.log(`  责任人：${workOrder.assignee}`);
  console.log(`  处置步骤：${workOrder.actions.map((item, i) => `\n    ${i + 1}. ${item}`).join("")}`);

  console.log(
    "\n对比：\n" +
      "  · 手写 JSON 解析（structured-output.ts）：提示词与解析都由自己控制，\n" +
      "    兼容任何模型，但需要处理“模型多输出一段解释”“JSON 不合法”等情况。\n" +
      "  · withStructuredOutput：业务代码更干净，schema 一处定义处处复用，\n" +
      "    但依赖模型支持 tool/JSON mode，换模型时要回归验证。\n" +
      "  真实项目里：主链路用原生结构化输出，兜底保留手写解析与降级提示词。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
