import "dotenv/config";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

// 学习目标：MCP 资源（Resources）的发现、读取与订阅
// Tools 是「让别人调用的动作」，Resources 是「可以被读取的数据」。
// 三类典型用法：
//   1. 资源发现：listResources / listResourceTemplates，让 Client 动态知道有哪些数据
//   2. 资源读取：readResource(uri)，例如把设备清单注入提示词
//   3. 资源订阅：subscribe(uri)，数据变化时由 Server 推送通知，Client 无需轮询
// 运行（带订阅演示）：
//   MCP_RESOURCE_TICK=1 npx tsx src/week6-mcp/mcp-resource-client.ts
// 不带订阅演示：
//   npx tsx src/week6-mcp/mcp-resource-client.ts

const SERVER_SCRIPT = path.resolve(process.cwd(), "src/week6-mcp/mcp-weather-server.ts");

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return env;
}

const main = async () => {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", SERVER_SCRIPT],
    env: serverEnv(),
  });

  const client = new Client({ name: "week6-resource-client", version: "1.0.0" });
  await client.connect(transport);

  // ---------- 1. 资源发现 ----------
  const { resources } = await client.listResources();
  console.log("================ 资源清单 ================");
  for (const item of resources) {
    console.log(`  ${item.uri}｜${item.name}｜${item.mimeType ?? "-"}`);
    console.log(`      ${item.description ?? ""}`);
  }

  const templates = await client.listResourceTemplates();
  console.log(`\n资源模板（带参数的 URI 模式）：${templates.resourceTemplates.length} 个`);
  for (const item of templates.resourceTemplates) {
    console.log(`  ${item.uriTemplate}｜${item.name}`);
  }

  // ---------- 2. 资源读取：把数据注入后续处理 ----------
  const stations = await client.readResource({ uri: "weather://stations" });
  const thresholds = await client.readResource({ uri: "weather://thresholds" });

  console.log("\n================ 资源读取 ================");

  const stationsText =
    stations.contents[0] && "text" in stations.contents[0] ? stations.contents[0].text : "";
  const thresholdsText =
    thresholds.contents[0] && "text" in thresholds.contents[0]
      ? thresholds.contents[0].text
      : "";

  console.log("weather://stations ->");
  console.log(stationsText);

  console.log("weather://thresholds ->");
  console.log(thresholdsText);

  // 一个真实用途：用资源内容做规则判断，而不是让模型凭空猜
  const thresholdMap = JSON.parse(thresholdsText) as Record<string, number>;
  const stationList = JSON.parse(stationsText) as { city: string; temperature: number }[];

  console.log("\n规则判定（资源数据 + 业务规则）：");
  for (const station of stationList) {
    const threshold = thresholdMap[station.city];
    if (threshold === undefined) {
      continue;
    }

    const exceeded = station.temperature >= threshold;
    console.log(
      `  ${station.city}：${station.temperature}℃ / 阈值 ${threshold}℃ -> ${
        exceeded ? "需要提前开启空调" : "按常规策略运行"
      }`
    );
  }

  // ---------- 3. 资源订阅：让 Server 主动推送变更 ----------
  console.log("\n================ 资源订阅 ================");

  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
    console.log(`  [通知] 资源已更新：${notification.params.uri}（收到时间 ${new Date().toISOString()}）`);
  });

  try {
    await client.subscribeResource({ uri: "weather://stations" });
    console.log("  已订阅 weather://stations，等待 Server 推送变更通知……");
    console.log(
      "  提示：Server 端需要声明 subscribe 能力，并在数据变化时调用 sendResourceUpdated。\n" +
        "        本示例可用 MCP_RESOURCE_TICK=1 启动 Server 端定时推送。"
    );

    // 留出时间接收通知；没有推送时 3 秒后继续
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    await client.unsubscribeResource({ uri: "weather://stations" });
    console.log("  已取消订阅");
  } catch (error) {
    console.log(
      `  订阅失败（Server 未声明 subscribe 能力？）：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  await client.close();

  console.log(
    "\n工程要点：\n" +
      "  · 资源适合「大块、可复用、需要版本」的数据：配置、规范、设备全量清单；\n" +
      "  · 与工具的区别：工具是动作（可写、有副作用），资源是数据（只读、可订阅）；\n" +
      "  · 订阅能替代轮询，但要在 Client 侧做「断线重连 + 重新订阅」，\n" +
      "    并把最近一次数据落本地缓存，避免通知丢失期间读到空数据；\n" +
      "  · 资源内容同样属于「外部不可信内容」，注入模型前要按第 7 周的方式做隔离。"
  );
};

main().catch((error: unknown) => {
  console.error("执行失败：", error);
  process.exitCode = 1;
});
