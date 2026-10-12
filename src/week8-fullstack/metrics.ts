// 学习目标：服务指标（Metrics）
// Agent 上线后必须能回答三个问题：调用量多少、错误多少、慢在哪。
// 这里手写一个轻量指标注册表，把「采集 -> 聚合 -> 暴露」链路走通。
// 生产环境换成 Prometheus client（计数器/直方图）+ /metrics 端点，
// 但口径与聚合思路与这里完全一致。
// 使用：见 server.ts 的 requestLogMiddleware 与 /api/metrics

export interface RequestSample {
  /** 归一化后的路由，例如 /api/tasks/:taskId/stream */
  route: string;
  method: string;
  status: number;
  durationMs: number;
  at: string;
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  totalRequests: number;
  errorRequests: number;
  errorRate: string;
  activeSseConnections: number;
  tasksCreated: number;
  tokensUsed: number;
  latencyMs: {
    avg: number;
    p50: number;
    p95: number;
    max: number;
  };
  byRoute: { route: string; count: number; errors: number; avgMs: number }[];
  recentErrors: RequestSample[];
}

/** 百分位：把样本排序后取对应位置（小数据量下足够，不需要直方图桶） */
function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

export class MetricsRegistry {
  private readonly startedAt = Date.now();
  private requests: RequestSample[] = [];
  private sseConnections = 0;
  private tasks = 0;
  private tokens = 0;

  /** 记录一次 HTTP 请求 */
  record(sample: RequestSample): void {
    this.requests.push(sample);

    // 只保留最近 500 条，避免内存随运行时间无限增长（生产用直方图聚合）
    if (this.requests.length > 500) {
      this.requests = this.requests.slice(-500);
    }
  }

  sseOpen(): void {
    this.sseConnections += 1;
  }

  sseClose(): void {
    this.sseConnections = Math.max(0, this.sseConnections - 1);
  }

  taskCreated(): void {
    this.tasks += 1;
  }

  /**
   * 累计 token 用量。
   * Agent 层拿到 usage_metadata 后应调用这个方法（当前 demo 未透传 usage，
   * 真实项目里可在 runAgent 的返回值里带上 usage 再累加）。
   */
  addTokens(count: number): void {
    this.tokens += count;
  }

  snapshot(): MetricsSnapshot {
    const durations = this.requests.map((item) => item.durationMs).sort((a, b) => a - b);
    const errors = this.requests.filter((item) => item.status >= 400);

    const routeMap = new Map<string, { count: number; errors: number; totalMs: number }>();

    for (const item of this.requests) {
      const entry = routeMap.get(item.route) ?? { count: 0, errors: 0, totalMs: 0 };
      entry.count += 1;
      entry.totalMs += item.durationMs;

      if (item.status >= 400) {
        entry.errors += 1;
      }

      routeMap.set(item.route, entry);
    }

    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      totalRequests: this.requests.length,
      errorRequests: errors.length,
      errorRate:
        this.requests.length === 0
          ? "0%"
          : `${((errors.length / this.requests.length) * 100).toFixed(1)}%`,
      activeSseConnections: this.sseConnections,
      tasksCreated: this.tasks,
      tokensUsed: this.tokens,
      latencyMs: {
        avg:
          durations.length === 0
            ? 0
            : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
        p50: Math.round(percentile(durations, 0.5)),
        p95: Math.round(percentile(durations, 0.95)),
        max: durations.at(-1) ?? 0,
      },
      byRoute: [...routeMap.entries()]
        .map(([route, value]) => ({
          route,
          count: value.count,
          errors: value.errors,
          avgMs: Math.round(value.totalMs / value.count),
        }))
        .sort((a, b) => b.count - a.count),
      recentErrors: errors.slice(-5),
    };
  }
}

export const metrics = new MetricsRegistry();

/**
 * 把具体路径归一化成「路由模板」，否则 /api/tasks/task-1/stream 与
 * /api/tasks/task-2/stream 会被统计成两个不同的路由，指标就散了。
 */
export function normalizeRoute(path: string): string {
  return path.replace(/\/api\/tasks\/[^/]+\/stream/, "/api/tasks/:taskId/stream");
}
