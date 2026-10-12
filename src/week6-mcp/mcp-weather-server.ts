import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 学习目标：第二个 MCP Server（多 Server 场景的基础）
// mcp-server.ts 暴露的是「设施设备」能力，这里再写一个「天气」能力，
// 用来演示：同一个 Client 如何同时接入多个 Server，并把它们的工具合起来给模型用。
// 启动（通常由 Client 以子进程方式拉起）：npx tsx src/week6-mcp/mcp-weather-server.ts

// 模拟数据源
const weatherData: Record<string, { condition: string; temperature: number; humidity: number }> = {
  北京: { condition: "晴", temperature: 24, humidity: 35 },
  上海: { condition: "多云", temperature: 27, humidity: 65 },
  深圳: { condition: "小雨", temperature: 30, humidity: 80 },
};

const citySchema = z.enum(["北京", "上海", "深圳"]);

const server = new McpServer(
  { name: "campus-weather-mcp", version: "1.0.0" },
  {
    // 声明资源订阅能力：Client 可以 subscribe 某个 URI，Server 在数据变化时推送通知
    capabilities: { resources: { subscribe: true } },
  }
);

// ---------- Tools ----------

server.registerTool(
  "get_weather",
  {
    title: "查询天气",
    description: "查询指定城市的实时天气（只读操作）。园区能耗与巡检安排会参考该数据。",
    inputSchema: { city: citySchema },
  },
  ({ city }) => {
    const data = weatherData[city];

    if (!data) {
      return {
        isError: true,
        content: [{ type: "text", text: `暂无 ${city} 的天气数据` }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ city, ...data, updatedAt: new Date().toISOString() }),
        },
      ],
    };
  }
);

server.registerTool(
  "list_cities",
  {
    title: "可查询的城市",
    description: "列出当前支持查询天气的城市清单（只读操作）。",
    inputSchema: {},
  },
  () => ({
    content: [{ type: "text", text: JSON.stringify(Object.keys(weatherData)) }],
  })
);

// ---------- Resources ----------

server.registerResource(
  "weather-stations",
  "weather://stations",
  {
    title: "天气站点清单",
    description: "当前接入的天气站点及其最新观测值（JSON）。",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          Object.entries(weatherData).map(([city, data]) => ({ city, ...data })),
          null,
          2
        ),
      },
    ],
  })
);

server.registerResource(
  "weather-thresholds",
  "weather://thresholds",
  {
    title: "高温预警阈值",
    description: "各城市的高温预警阈值，用于判断是否需要提前开启空调。",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ 北京: 33, 上海: 35, 深圳: 34 }, null, 2),
      },
    ],
  })
);

// ---------- Prompts ----------

server.registerPrompt(
  "weather_briefing",
  {
    title: "天气简报",
    description: "生成指定城市天气对园区运行影响的简报模板。",
    argsSchema: { city: citySchema },
  },
  ({ city }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `请根据 ${city} 的天气数据，输出一份园区运行提示，包含：空调负荷预估、巡检注意事项、是否需要提前预警。`,
        },
      },
    ],
  })
);

// ---------- 启动（stdio 传输） ----------

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdio 模式下 console.log 会污染协议通道，日志一律走 stderr
  console.error("campus-weather-mcp 已通过 stdio 启动");

  // 可选：数据变更时主动推送资源更新通知，供 mcp-resource-client.ts 演示 subscribe
  if (process.env.MCP_RESOURCE_TICK === "1") {
    let tick = 0;

    setInterval(() => {
      tick += 1;

      // 模拟观测值变化
      for (const data of Object.values(weatherData)) {
        data.temperature += tick % 2 === 0 ? 1 : -1;
      }

      // 通知走底层 Server 实例（McpServer 只封装了工具/资源/提示注册）
      void server.server.sendResourceUpdated({ uri: "weather://stations" });
      console.error(`已推送资源更新通知（第 ${tick} 次）`);
    }, 2_000);
  }
};

main().catch((error: unknown) => {
  console.error("MCP Server 启动失败：", error);
  process.exitCode = 1;
});
