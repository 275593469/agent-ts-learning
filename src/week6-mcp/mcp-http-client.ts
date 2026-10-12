import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// 学习目标：用 HTTP 传输连接 MCP Server
// 与 mcp-client.ts（stdio，子进程）相比，这里连接的是一个已经跑起来的长驻服务。
// 重点看三件事：
//   1. 传输层的差异被 SDK 屏蔽，Client 的调用方式完全一样
//   2. 鉴权通过 HTTP 头传递（stdio 版是靠环境变量）
//   3. 连不上时要给出可操作的错误提示，而不是抛出栈
// 运行前先启动服务端：npx tsx src/week6-mcp/mcp-http-server.ts
// 然后运行：npx tsx src/week6-mcp/mcp-http-client.ts

const ENDPOINT = process.env.MCP_HTTP_ENDPOINT ?? "http://127.0.0.1:3100/mcp";
const TOKEN = process.env.MCP_AUTH_TOKEN ?? "demo-token";

/**
 * SDK 的可选属性与项目开启的 exactOptionalPropertyTypes 不兼容（库类型问题），
 * 这里收敛一次，避免在每个调用点重复断言。
 */
function asTransport(value: StreamableHTTPClientTransport): Transport {
  return value as unknown as Transport;
}

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: {
      headers: { Authorization: `Bearer ${TOKEN}` },
    },
  });

  const client = new Client({ name: "week6-http-client", version: "1.0.0" });

  try {
    await client.connect(asTransport(transport));
  } catch (error) {
    console.error(
      `连接 ${ENDPOINT} 失败：${error instanceof Error ? error.message : String(error)}`
    );
    console.error(
      "请先启动服务端：npx tsx src/week6-mcp/mcp-http-server.ts\n" +
        "若已启动，请检查令牌是否与服务端 MCP_AUTH_TOKEN 一致。"
    );
    process.exitCode = 1;
    return;
  }

  // 1. 工具发现（与 stdio 版代码完全一致）
  const { tools } = await client.listTools();
  console.log("================ 工具发现 ================");
  for (const item of tools) {
    console.log(`  ${item.name}｜${item.description ?? ""}`);
  }

  // 2. 调用工具
  const result = await client.callTool({
    name: "query_devices",
    arguments: { area: "A座" },
  });
  console.log("\n================ 调用 query_devices ================");
  console.log(JSON.stringify(result.content, null, 2));

  // 3. 读取资源
  const resource = await client.readResource({ uri: "device://list" });
  const text =
    resource.contents[0] && "text" in resource.contents[0] ? resource.contents[0].text : "";
  console.log("\n================ 读取 device://list ================");
  console.log(text.slice(0, 200) + (text.length > 200 ? "\n  …（已截断）" : ""));

  // 4. 获取提示模板
  const prompt = await client.getPrompt({
    name: "device_report",
    arguments: { area: "C座" },
  });
  console.log("\n================ 提示模板 device_report ================");
  console.log(JSON.stringify(prompt.messages, null, 2));

  // 5. 演示鉴权失败的样子（用错误令牌新建一个连接）
  console.log("\n================ 鉴权失败对照 ================");
  const badTransport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers: { Authorization: "Bearer wrong-token" } },
  });
  const badClient = new Client({ name: "week6-http-client-bad", version: "1.0.0" });

  try {
    await badClient.connect(asTransport(badTransport));
    await badClient.listTools();
    console.log("  未按预期拒绝：请检查服务端鉴权中间件");
  } catch (error) {
    console.log(`  预期内的拒绝：${error instanceof Error ? error.message : String(error)}`);
  }

  await client.close();

  console.log(
    "\n工程要点：\n" +
      "  · 业务代码（工具/资源/提示的定义）与传输方式解耦，\n" +
      "    同一套能力可以先用 stdio 本地调试，再挂到 HTTP 上对外提供；\n" +
      "  · HTTP 部署的三件套：鉴权（网关或中间件）、限流、审计日志；\n" +
      "  · 无状态模式最简单、最好扩容；需要服务端推送（资源订阅、长任务进度）时才引入会话；\n" +
      "  · 客户端要处理「连接失败」与「令牌过期」，并支持自动重连后重新 listTools。"
  );
}

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
