// 学习目标：日志追踪
// Agent 的执行链路（模型调用、工具调用、安全拦截）都要留下结构化轨迹，
// 便于线上排查问题、统计耗时与复盘。

export type TraceEventType = "model" | "tool" | "guard" | "finish";

export interface TraceEvent {
  type: TraceEventType;
  step: string;
  detail: string;
  timestamp: string;
  durationMs?: number;
}

export class TraceLogger {
  private readonly events: TraceEvent[] = [];

  constructor(private readonly traceId: string) {}

  log(type: TraceEventType, step: string, detail: string): void {
    this.events.push({
      type,
      step,
      detail,
      timestamp: new Date().toISOString(),
    });
  }

  /** 包裹一次异步操作并记录耗时 */
  async time<T>(type: TraceEventType, step: string, task: () => Promise<T>): Promise<T> {
    const start = Date.now();

    try {
      const result = await task();
      this.events.push({
        type,
        step,
        detail: "ok",
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
      });
      return result;
    } catch (error) {
      this.events.push({
        type,
        step,
        detail: `error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  toJSON(): { traceId: string; events: TraceEvent[] } {
    return { traceId: this.traceId, events: this.events };
  }

  print(): void {
    console.log(`\n执行轨迹 traceId=${this.traceId}`);
    for (const event of this.events) {
      const duration = event.durationMs === undefined ? "" : ` (${event.durationMs}ms)`;
      console.log(`  [${event.type}] ${event.step}${duration} - ${event.detail}`);
    }
  }
}
