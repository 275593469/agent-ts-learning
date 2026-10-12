import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

// 学习目标：HTTP 传输的 MCP Server（Streamable HTTP）
// stdio 传输适合「本地单机、由 Client 拉起子进程」的场景（见 mcp-server.ts）。
// 一旦要上生产：常驻进程、多客户端共享、独立扩容、统一鉴权，就该换成 HTTP 传输。
// 三者对比：
//   · stdio        ：零网络配置，进程随 Client 生死，无法多客户端共享
//   · Streamable HTTP：标准 HTTP 端点，可部署在网关后，天然支持鉴权与水平扩展
// 运行：npx tsx src/week6-mcp/mcp-http-server.ts
// 然后用另一个终端跑：npx tsx src/week6-mcp/mcp-http-client.ts

const PORT = Number(process.env.MCP_HTTP_PORT ?? 3100);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "demo-token";

/**
 * MCP SDK 把部分可选属性声明为 `T | undefined`，与本项目开启的 exactOptionalPropertyTypes
 * 不兼容（库类型与严格配置的冲突，与业务逻辑无关）。
 * 集中在这里收敛一次，避免每个调用点都写断言。
 */
function createStatelessTransport(): StreamableHTTPServerTransport {
  const options = { sessionIdGenerator: undefined };

  return new StreamableHTTPServerTransport(
    options as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]
  );
}

/** 同上：把传输实例收敛成 Transport 接口 */
function asTransport(value: StreamableHTTPServerTransport): Transport {
  return value as unknown as Transport;
}

// ---------- 1. 业务能力（与 stdio 版完全一致，传输方式不影响业务实现） ----------

const devices = [
  { id: "D001", type: "空调机组", area: "A座", status: "正常" },
  { id: "D002", type: "电梯", area: "A座", status: "异常" },
  { id: "D003", type: "门禁", area: "B座", status: "正常" },
  { id: "D004", type: "空调机组", area: "B座", status: "正常" },
  { id: "D005", type: "电梯", area: "C座", status: "异常" },
];

const areaSchema = z.enum(["A座", "B座", "C座", "全部"]);

/**
 * 无状态模式：每个请求创建一个新的 server + transport 实例，
 * 请求之间不共享内存状态，因此可以直接水平扩容（任意实例都能处理任意请求）。
 * 需要「会话」的场景（长连接、服务端主动推送）要改成有状态模式并自己管理 sessionId。
 */
function buildServer(): McpServer {
  const server = new McpServer({ name: "campus-facility-http-mcp", version: "1.0.0" });

  server.registerTool(
    "query_devices",
    {
      title: "查询设备",
      description: "按区域查询园区设施设备清单（只读操作）。",
      inputSchema: { area: areaSchema },
    },
    ({ area }) => {
      const matched =
        area === "全部" ? devices : devices.filter((item) => item.area === area);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ area, total: matched.length, devices: matched }),
          },
        ],
      };
    }
  );

  server.registerResource(
    "device-list",
    "device://list",
    {
      title: "全量设备清单",
      description: "当前所有园区设施设备的 JSON 清单。",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(devices, null, 2),
        },
      ],
    })
  );

  server.registerPrompt(
    "device_report",
    {
      title: "设备运行报告",
      description: "生成指定区域的设备运行报告模板。",
      argsSchema: { area: areaSchema },
    },
    ({ area }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `请根据 ${area} 的设备数据，输出一份设备运行报告，包含：设备总数、异常设备清单、处理建议。`,
          },
        },
      ],
    })
  );

  return server;
}

// ---------- 2. HTTP 接入层：鉴权 + 传输适配 ----------

// createMcpExpressApp 会带上 DNS rebinding 防护等基础中间件（绑定 localhost 时自动开启）
const app = createMcpExpressApp({ host: "127.0.0.1" });

/** 简单的 Bearer Token 鉴权：生产环境换成 OAuth / 网关鉴权 */
app.use("/mcp", (req, res, next) => {
  const header = req.headers.authorization ?? "";

  if (header !== `Bearer ${AUTH_TOKEN}`) {
    res.status(401).json({
      error: "unauthorized",
      message: "缺少或错误的 Authorization 头（应形如 Bearer <token>）",
    });
    return;
  }

  next();
});

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  // 无状态模式：sessionIdGenerator = undefined，不维护会话
  const transport = createStatelessTransport();

  // 请求结束/中断时释放资源，避免流与监听器泄漏
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(asTransport(transport));
  await transport.handleRequest(req, res, req.body);
});

// 无状态模式下不支持服务端主动推送，GET / DELETE 明确拒绝
app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "method_not_allowed", message: "无状态模式不支持 SSE 长连接" });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: "method_not_allowed", message: "无状态模式没有会话可删除" });
});

const main = () => {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`MCP HTTP Server 已启动：http://127.0.0.1:${PORT}/mcp`);
    console.log(`鉴权令牌：Bearer ${AUTH_TOKEN}（可通过 MCP_AUTH_TOKEN 覆盖）`);
    console.log(`自测请求 id：${randomUUID()}`);
    console.log("客户端示例：npx tsx src/week6-mcp/mcp-http-client.ts");
  });
};

main();
