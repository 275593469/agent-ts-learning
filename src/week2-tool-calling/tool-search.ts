import "dotenv/config";
import { z } from "zod";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";

// 学习目标：工具检索式选择（Tool RAG / Tool Retrieval）
// 工具一旦超过 15~20 个，全量 bind 会带来两个问题：
//   1. 工具定义本身占满上下文（每个工具的名字 + 描述 + 参数 schema 都要发给模型）
//   2. 候选太多，模型更容易选错工具
// 解法：先用一句「工具描述检索」把候选缩到 TopK，再 bind 给模型。
// 运行：npx tsx src/week2-tool-calling/tool-search.ts

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

// ---------- 1. 一个略具规模的工具库（园区运营场景，15 个） ----------

const areaSchema = z.object({
  area: z.enum(["A座", "B座", "C座", "全部"]).describe("楼栋区域"),
});

interface ToolSpec {
  name: string;
  description: string;
  build: (name: string, description: string) => StructuredToolInterface;
}

const toolSpecs: ToolSpec[] = [
  {
    name: "query_devices",
    description: "查询指定楼栋的设施设备清单（空调机组、电梯、门禁）与运行状态。",
    build: (name, description) =>
      tool(async ({ area }) => JSON.stringify({ area, total: 5 }), {
        name,
        description,
        schema: areaSchema,
      }),
  },
  {
    name: "count_abnormal_devices",
    description: "统计指定楼栋的异常设备数量与明细，用于巡检排班。",
    build: (name, description) =>
      tool(async ({ area }) => JSON.stringify({ area, abnormal: 2 }), {
        name,
        description,
        schema: areaSchema,
      }),
  },
  {
    name: "get_energy_metric",
    description: "查询园区能耗指标（总用电量），支持本月与上月对比。",
    build: (name, description) =>
      tool(async () => JSON.stringify({ month: 128.6, lastMonth: 119.4 }), {
        name,
        description,
        schema: z.object({}),
      }),
  },
  {
    name: "get_energy_intensity",
    description: "查询各楼栋的能耗强度（kWh/㎡），用于能耗排名与节能分析。",
    build: (name, description) =>
      tool(async () => JSON.stringify([{ area: "A座", value: 98.2 }]), {
        name,
        description,
        schema: z.object({}),
      }),
  },
  {
    name: "list_work_orders",
    description: "检索工单列表，可按状态（待处理、处理中、已完成）与楼栋过滤。",
    build: (name, description) =>
      tool(async ({ status }) => JSON.stringify({ status, total: 12 }), {
        name,
        description,
        schema: z.object({ status: z.enum(["待处理", "处理中", "已完成"]) }),
      }),
  },
  {
    name: "create_work_order",
    description: "创建维修工单并自动派单（写操作，需要 operator 及以上权限）。",
    build: (name, description) =>
      tool(
        async ({ deviceId }) => JSON.stringify({ deviceId, orderId: "WO-2024-001" }),
        {
          name,
          description,
          schema: z.object({ deviceId: z.string() }),
        }
      ),
  },
  {
    name: "get_elevator_maintenance",
    description: "查询电梯维保记录与下次维保到期时间。",
    build: (name, description) =>
      tool(async () => JSON.stringify({ last: "2024-09-12", next: "2024-10-12" }), {
        name,
        description,
        schema: z.object({}),
      }),
  },
  {
    name: "get_access_logs",
    description: "查询门禁通行记录，支持按人员或时间段检索。",
    build: (name, description) =>
      tool(async () => JSON.stringify({ records: 128 }), {
        name,
        description,
        schema: z.object({ person: z.string().optional() }),
      }),
  },
  {
    name: "get_hvac_setpoint",
    description: "查询空调机组的设定温度与运行模式。",
    build: (name, description) =>
      tool(async () => JSON.stringify({ setpoint: 25, mode: "制冷" }), {
        name,
        description,
        schema: z.object({}),
      }),
  },
  {
    name: "set_hvac_setpoint",
    description: "修改空调机组设定温度（写操作，需要 operator 及以上权限）。",
    build: (name, description) =>
      tool(async ({ setpoint }) => JSON.stringify({ setpoint, ok: true }), {
        name,
        description,
        schema: z.object({ setpoint: z.number() }),
      }),
  },
  {
    name: "list_tenants",
    description: "查询园区租户清单与合同到期时间。",
    build: (name, description) =>
      tool(async () => JSON.stringify([{ name: "某科技公司", rooms: "8F" }]), {
        name,
        description,
        schema: z.object({}),
      }),
  },
  {
    name: "book_meeting_room",
    description: "预订会议室，需要提供会议室编号与时间段。",
    build: (name, description) =>
      tool(async () => JSON.stringify({ ok: true }), {
        name,
        description,
        schema: z.object({ room: z.string(), slot: z.string() }),
      }),
  },
  {
    name: "get_parking_usage",
    description: "查询停车场实时占用率与剩余车位。",
    build: (name, description) =>
      tool(async () => JSON.stringify({ used: 312, total: 400 }), {
        name,
        description,
        schema: z.object({}),
      }),
  },
  {
    name: "get_weather",
    description: "查询指定城市的实时天气，用于判断能耗与巡检安排。",
    build: (name, description) =>
      tool(async ({ city }) => JSON.stringify({ city, temperature: 27 }), {
        name,
        description,
        schema: z.object({ city: z.enum(["北京", "上海", "深圳"]) }),
      }),
  },
  {
    name: "query_water_leak",
    description: "查询园区给水管网的漏损情况与异常点位。",
    build: (name, description) =>
      tool(async () => JSON.stringify({ leaks: 1 }), {
        name,
        description,
        schema: z.object({}),
      }),
  },
];

const allTools: StructuredToolInterface[] = toolSpecs.map((spec) =>
  spec.build(spec.name, spec.description)
);

// ---------- 2. 工具检索：按描述相似度挑 TopK ----------

/** 中文按字符 bigram 切词（与第 4 周的本地检索思路一致） */
function toBigrams(text: string): string[] {
  const clean = text.replace(/[\s，。、：；（）()，,]/g, "");
  const grams: string[] = [];

  for (let i = 0; i < clean.length - 1; i++) {
    grams.push(clean.slice(i, i + 2));
  }

  return grams;
}

/** 描述检索：查询 bigram 在工具「名称 + 描述」中的命中比例 */
function scoreTool(queryGrams: string[], spec: ToolSpec): number {
  const haystack = `${spec.name} ${spec.description}`;

  if (queryGrams.length === 0) {
    return 0;
  }

  const hit = queryGrams.filter((gram) => haystack.includes(gram)).length;
  return hit / queryGrams.length;
}

function selectTools(query: string, k: number): { name: string; score: number }[] {
  const grams = toBigrams(query);

  return toolSpecs
    .map((spec) => ({ name: spec.name, score: scoreTool(grams, spec) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- 3. token 占用估算（工具定义也是成本） ----------

function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk + Math.ceil(Math.max(0, text.length - cjk) / 4);
}

function toolDefinitionText(tools: StructuredToolInterface[]): string {
  return tools
    .map((item) => `${item.name}: ${item.description} 参数=${JSON.stringify(item.schema)}`)
    .join("\n");
}

// ---------- 4. 对比实验 ----------

async function askWith(question: string, visible: StructuredToolInterface[]) {
  const messages: BaseMessage[] = [
    new SystemMessage(
      "你是园区运营助手。需要数据时必须调用工具，一次可以调用多个；不要编造数据。"
    ),
    new HumanMessage(question),
  ];

  const response = await model.bindTools(visible).invoke(messages);

  return {
    planned: (response.tool_calls ?? []).map((call) => call.name),
    promptTokens: estimateTokens(toolDefinitionText(visible)),
  };
}

const QUESTION = "对比一下各楼栋的能耗强度，并且看看有没有给水管网漏损。";

const main = async () => {
  console.log(`问题：${QUESTION}\n`);

  const all = await askWith(QUESTION, allTools);
  console.log(`【全量 bind】可见工具 ${allTools.length} 个`);
  console.log(`  工具定义约占：${all.promptTokens} token`);
  console.log(`  模型选择：${all.planned.join(", ") || "无"}`);

  const picked = selectTools(QUESTION, 3);
  const visibleNames = new Set(picked.map((item) => item.name));
  const visible = allTools.filter((item) => visibleNames.has(item.name));

  console.log("\n【检索式选择】先按描述相似度召回 Top3：");
  for (const item of picked) {
    console.log(`  · ${item.name}（相似度 ${item.score.toFixed(3)}）`);
  }

  const narrowed = await askWith(QUESTION, visible);
  console.log(`  工具定义约占：${narrowed.promptTokens} token`);
  console.log(`  模型选择：${narrowed.planned.join(", ") || "无"}`);

  console.log(
    "\n结论：\n" +
      "  · 工具检索把「每轮都发全量工具定义」变成「只发相关工具」，\n" +
      "    既省 token，也降低选错工具的概率；\n" +
      "  · 召回失败会直接导致能力缺失，所以 K 要留冗余（常用 5~10），\n" +
      "    并保留「兜底：允许模型请求更多工具」的出口；\n" +
      "  · 工具描述写得像文档（同义词、业务口径、典型问法）比调参更有效，\n" +
      "    这是检索质量的上限所在。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
