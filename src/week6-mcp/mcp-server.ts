import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 学习目标：MCP Server —— 把现有业务查询接口封装成标准 MCP 工具
// 一个 MCP Server 暴露三类能力：
//   1. Tools（工具）：可执行的操作，如查询设备
//   2. Resources（资源）：可读取的数据，如设备清单
//   3. Prompts（提示模板）：可复用的提示词模板
// 启动（由 Client 以子进程方式拉起）：npx tsx src/week6-mcp/mcp-server.ts

// 模拟业务数据源
const devices = [
  { id: "D001", type: "空调机组", area: "A座", status: "正常" },
  { id: "D002", type: "电梯", area: "A座", status: "异常" },
  { id: "D003", type: "门禁", area: "B座", status: "正常" },
  { id: "D004", type: "空调机组", area: "B座", status: "正常" },
  { id: "D005", type: "电梯", area: "C座", status: "异常" },
];

const areaSchema = z.enum(["A座", "B座", "C座", "全部"]);

const server = new McpServer({
  name: "campus-facility-mcp",
  version: "1.0.0",
});

// ---------- Tools ----------

server.registerTool(
  "query_devices",
  {
    title: "查询设备",
    description: "按区域查询园区设施设备清单（只读操作）。",
    inputSchema: { area: areaSchema },
  },
  async ({ area }) => {
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

server.registerTool(
  "update_device_status",
  {
    title: "更新设备状态",
    description: "修改指定设备的运行状态（写操作，需要授权）。",
    inputSchema: {
      deviceId: z.string(),
      status: z.enum(["正常", "异常"]),
    },
  },
  async ({ deviceId, status }) => {
    // 访问授权：写操作必须携带正确的令牌
    if (process.env.MCP_AUTH_TOKEN !== "demo-token") {
      return {
        isError: true,
        content: [{ type: "text", text: "无权限执行写操作：缺少或错误的 MCP_AUTH_TOKEN" }],
      };
    }

    const target = devices.find((item) => item.id === deviceId);

    if (!target) {
      return {
        isError: true,
        content: [{ type: "text", text: `设备不存在：${deviceId}` }],
      };
    }

    target.status = status;

    return {
      content: [{ type: "text", text: JSON.stringify(target) }],
    };
  }
);

// ---------- Resources ----------

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

// ---------- Prompts ----------

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

// ---------- 启动（stdio 传输） ----------

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 注意：stdio 模式下不要用 console.log，会污染协议通道，日志请用 console.error
  console.error("campus-facility-mcp 已通过 stdio 启动");
};

main().catch((error: unknown) => {
  console.error("MCP Server 启动失败：", error);
  process.exitCode = 1;
});
