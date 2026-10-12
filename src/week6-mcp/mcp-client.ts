import "dotenv/config";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

// 学习目标：MCP Client
// 1. 连接 MCP Server（这里以子进程 + stdio 方式启动）
// 2. 工具发现（listTools）与调用（callTool）
// 3. 读取资源（readResource）与获取提示模板（getPrompt）
// 4. 通过 @langchain/mcp-adapters 把 MCP 工具转成 LangChain 工具，交给大模型使用
// 运行：npx tsx src/week6-mcp/mcp-client.ts

const SERVER_SCRIPT = path.resolve(process.cwd(), "src/week6-mcp/mcp-server.ts");

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  // 访问授权：写操作需要的令牌
  env.MCP_AUTH_TOKEN = "demo-token";
  return env;
}

/** 第 1 部分：低层 Client，演示工具发现 / 调用 / 资源 / 提示模板 */
async function lowLevelDemo() {
  console.log("========== 1. 低层 MCP Client ==========");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", SERVER_SCRIPT],
    env: serverEnv(),
  });

  const client = new Client({ name: "week6-client", version: "1.0.0" });
  await client.connect(transport);

  // 工具发现
  const { tools } = await client.listTools();
  console.log("发现的工具：", tools.map((item) => item.name).join(", "));

  // 调用工具
  const result = await client.callTool({
    name: "query_devices",
    arguments: { area: "B座" },
  });
  console.log("query_devices 返回：", JSON.stringify(result.content));

  // 读取资源
  const resource = await client.readResource({ uri: "device://list" });
  console.log("资源 device://list 已读取，内容长度：", JSON.stringify(resource.contents).length);

  // 获取提示模板
  const prompt = await client.getPrompt({
    name: "device_report",
    arguments: { area: "A座" },
  });
  console.log("提示模板 device_report：", JSON.stringify(prompt.messages));

  await client.close();
}

/** 第 2 部分：把 MCP 工具接入大模型 */
async function langchainDemo() {
  console.log("\n========== 2. MCP 工具接入大模型 ==========");

  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey || !modelName) {
    console.log("未配置模型，跳过第 2 部分。");
    return;
  }

  const mcpClient = new MultiServerMCPClient({
    mcpServers: {
      campus: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", SERVER_SCRIPT],
        env: serverEnv(),
      },
    },
  });

  const lcTools = await mcpClient.getTools();
  console.log("转换为 LangChain 工具：", lcTools.map((item) => item.name).join(", "));

  const model = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });

  const modelWithTools = model.bindTools(lcTools);
  const messages: BaseMessage[] = [
    new SystemMessage("你是园区设施运维助手，需要设备数据时请调用工具。"),
    new HumanMessage("A座有哪些异常设备？"),
  ];

  for (let step = 1; step <= 4; step++) {
    const aiMessage = await modelWithTools.invoke(messages);

    if (!aiMessage.tool_calls?.length) {
      console.log("助手：", aiMessage.content);
      break;
    }

    messages.push(aiMessage);

    for (const call of aiMessage.tool_calls) {
      const target = lcTools.find((item) => item.name === call.name);

      if (!target || !call.id) {
        messages.push(
          new ToolMessage({
            tool_call_id: call.id ?? "unknown",
            name: call.name,
            status: "error",
            content: `未知工具：${call.name}`,
          })
        );
        continue;
      }

      const toolMessage = await target.invoke(call);
      messages.push(toolMessage);
    }
  }

  await mcpClient.close();
}

const main = async () => {
  await lowLevelDemo();
  await langchainDemo();
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
