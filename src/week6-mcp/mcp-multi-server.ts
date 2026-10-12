import "dotenv/config";
import path from "node:path";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// 学习目标：多 MCP Server 聚合（Multi-Server）
// 真实系统里能力通常由多个 Server 提供：设施 Server、天气 Server、工单 Server……
// Client 侧要做三件事：
//   1. 把多个 Server 的工具聚合到同一个工具池（getTools 会自动加前缀避免重名）
//   2. 记录每个工具来自哪个 Server，便于按来源做权限与审计
//   3. 让模型跨 Server 完成一次任务（本例：同时查设备和天气）
// 运行：npx tsx src/week6-mcp/mcp-multi-server.ts

const SERVER_DIR = "src/week6-mcp";

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  // 设施 Server 的写操作需要令牌
  env.MCP_AUTH_TOKEN = "demo-token";
  return env;
}

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

/** 按 Server 名划分可见工具（这里演示：只允许天气 Server 的只读工具 + 设施工具） */
const READONLY_PREFIXES: Record<string, string[]> = {
  campus: ["query_devices"],
  weather: ["get_weather", "list_cities"],
};

function isAllowed(fullName: string): boolean {
  return Object.values(READONLY_PREFIXES).some((names) =>
    names.some((name) => fullName === name || fullName.endsWith(`__${name}`))
  );
}

const main = async () => {
  const client = new MultiServerMCPClient({
    mcpServers: {
      campus: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", path.resolve(process.cwd(), SERVER_DIR, "mcp-server.ts")],
        env: serverEnv(),
      },
      weather: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", path.resolve(process.cwd(), SERVER_DIR, "mcp-weather-server.ts")],
        env: serverEnv(),
      },
    },
  });

  const tools = await client.getTools();

  console.log("================ 聚合后的工具池 ================");
  for (const item of tools) {
    const allowed = isAllowed(item.name);
    console.log(`  ${item.name}${allowed ? "" : "  <- 已被权限策略过滤"}`);
  }

  // 1. 按来源分组：工具名里带 Server 前缀，便于做权限与审计
  const visible = tools.filter((item) => isAllowed(item.name));
  console.log(`\n可用工具 ${visible.length} / ${tools.length} 个`);

  // 2. 让模型跨 Server 完成一次任务
  const messages: BaseMessage[] = [
    new SystemMessage(
      "你是园区值班助手，可以同时使用设施与天气数据。需要数据时调用工具，不要编造。"
    ),
    new HumanMessage("A座有哪些异常设备？同时看看上海的天气会不会影响空调负荷。"),
  ];

  for (let step = 1; step <= 5; step++) {
    const aiMessage = await model.bindTools(visible).invoke(messages);

    if (!aiMessage.tool_calls?.length) {
      console.log("\n================ 助手回答 ================");
      console.log(
        typeof aiMessage.content === "string"
          ? aiMessage.content
          : JSON.stringify(aiMessage.content)
      );
      break;
    }

    messages.push(aiMessage);

    // 3. 工具调用可以并行（不同 Server 之间互不影响）
    const results = await Promise.all(
      aiMessage.tool_calls.map(async (call) => {
        const target = visible.find((item) => item.name === call.name);

        if (!target) {
          return new ToolMessage({
            tool_call_id: call.id ?? "unknown",
            name: call.name,
            status: "error",
            content: `工具不可用（权限不足或不存在）：${call.name}`,
          });
        }

        console.log(`  [step ${step}] 调用 ${call.name} 参数=${JSON.stringify(call.args)}`);

        try {
          return await target.invoke(call);
        } catch (error) {
          return new ToolMessage({
            tool_call_id: call.id ?? "unknown",
            name: call.name,
            status: "error",
            content: `执行失败：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      })
    );

    messages.push(...results);
  }

  await client.close();

  console.log(
    "\n工程要点：\n" +
      "  · 聚合后的工具名会带 Server 前缀（如 campus__query_devices），避免重名冲突；\n" +
      "  · 前缀同时也是权限与审计的抓手：按 Server 粒度控制“这个 Agent 能用哪些能力”；\n" +
      "  · 子进程方式启动 Server 时，环境变量要显式透传（否则令牌、代理配置读不到）；\n" +
      "  · Server 越多启动越慢，生产上考虑常驻进程 + HTTP 传输，或按需懒加载。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
