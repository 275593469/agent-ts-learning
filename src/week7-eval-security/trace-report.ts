import { TraceLogger, type TraceEvent } from "./trace-logger.js";

// 学习目标：把执行轨迹汇总成报告
// trace-logger.ts 负责「采集」，这个文件负责「聚合」：
//   · 各阶段耗时（模型 vs 工具）—— 定位瓶颈
//   · 错误与拦截统计 —— 定位稳定性与安全问题
//   · 最慢步骤 TopN —— 找到优化的那一刀
// 真实项目里数据落在日志/链路系统（ELK、Jaeger、LangSmith），报告口径与这里一致。
// 运行：npx tsx src/week7-eval-security/trace-report.ts

interface TraceSummary {
  traceId: string;
  totalEvents: number;
  byType: Record<string, number>;
  totalDurationMs: number;
  modelDurationMs: number;
  toolDurationMs: number;
  errors: TraceEvent[];
  blocked: TraceEvent[];
  slowest: TraceEvent[];
}

/** 聚合：只依赖事件数组，便于替换数据来源 */
export function summarizeTrace(traceId: string, events: TraceEvent[]): TraceSummary {
  const byType: Record<string, number> = {};
  let totalDurationMs = 0;
  let modelDurationMs = 0;
  let toolDurationMs = 0;

  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;

    const duration = event.durationMs ?? 0;
    totalDurationMs += duration;

    if (event.type === "model") {
      modelDurationMs += duration;
    } else if (event.type === "tool") {
      toolDurationMs += duration;
    }
  }

  return {
    traceId,
    totalEvents: events.length,
    byType,
    totalDurationMs,
    modelDurationMs,
    toolDurationMs,
    errors: events.filter((item) => item.detail.startsWith("error:")),
    // 注意区分「检查通过」与「真的拦下来了」：只有拦截才需要告警
    blocked: events.filter((item) => item.type === "guard" && item.detail.includes("拦截")),
    slowest: [...events]
      .filter((item) => item.durationMs !== undefined)
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, 3),
  };
}

export function printSummary(summary: TraceSummary): void {
  console.log(`\n============== 轨迹报告 traceId=${summary.traceId} ==============`);
  console.log(`  事件总数：${summary.totalEvents}`);
  console.log(
    `  分类计数：${Object.entries(summary.byType)
      .map(([type, count]) => `${type}=${count}`)
      .join("  ")}`
  );
  console.log(`  总耗时：${summary.totalDurationMs}ms`);
  console.log(
    `  其中模型调用 ${summary.modelDurationMs}ms / 工具调用 ${summary.toolDurationMs}ms` +
      `（占 ${summary.totalDurationMs === 0 ? "0" : ((summary.modelDurationMs / summary.totalDurationMs) * 100).toFixed(0)}% / ` +
      `${summary.totalDurationMs === 0 ? "0" : ((summary.toolDurationMs / summary.totalDurationMs) * 100).toFixed(0)}%）`
  );

  console.log(`  最慢步骤 Top3：`);
  for (const event of summary.slowest) {
    console.log(`    · [${event.type}] ${event.step} ${event.durationMs}ms`);
  }

  console.log(`  错误（${summary.errors.length} 条）：`);
  for (const event of summary.errors) {
    console.log(`    · ${event.step}｜${event.detail}`);
  }

  console.log(`  安全拦截（${summary.blocked.length} 条）：`);
  for (const event of summary.blocked) {
    console.log(`    · ${event.step}｜${event.detail}`);
  }
}

/** 模拟一次真实请求的轨迹：正常调用 + 一次慢工具 + 一次注入拦截 + 一次失败重试 */
function buildSampleTrace(): TraceLogger {
  const trace = new TraceLogger("trace-20241012-0001");

  trace.log("guard", "input-check", "通过：未发现注入特征");
  trace.log("model", "select-tool", "ok");
  trace.log("tool", "query_devices", "ok");
  trace.log("tool", "get_business_metric", "error: 下游超时（3000ms）");
  trace.log("model", "summarize", "ok");
  trace.log("guard", "input-check#2", "拦截注入：忽略之前的指令");
  trace.log("finish", "eval", "toolAcc=87.5%");

  // 补上耗时信息（TraceLogger.time 会在真实调用时自动记录）
  const events = trace.toJSON().events;
  const durations = [4, 612, 38, 3_020, 980, 2, 1];

  events.forEach((event, index) => {
    const duration = durations[index];
    if (duration !== undefined) {
      event.durationMs = duration;
    }
  });

  return trace;
}

const main = () => {
  const trace = buildSampleTrace();
  const { traceId, events } = trace.toJSON();

  console.log("原始轨迹（trace-logger 采集到的内容）：");
  trace.print();

  const summary = summarizeTrace(traceId, events);
  printSummary(summary);

  console.log(
    "\n从报告里能读出的结论：\n" +
      "  1. 耗时集中在工具调用（3020ms 的那次超时），优化方向是超时时间与重试策略，\n" +
      "     而不是去压缩提示词；\n" +
      "  2. 有一次 error 事件但没有掩盖最终结果 —— 说明容错路径生效了，\n" +
      "     这类“失败但可用”的请求必须单独统计，否则会被平均耗时掩盖；\n" +
      "  3. 有 1 条注入被拦，安全拦截量突然升高往往意味着有人在试探，值得告警。"
  );
};

main();
