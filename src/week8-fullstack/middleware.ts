import type { NextFunction, Request, RequestHandler, Response } from "express";
import { metrics, normalizeRoute } from "./metrics.js";

// 学习目标：服务端中间件（鉴权 / 限流 / 日志）
// 这三件套是任何一个对外提供服务的最小工程配套：
//   · 鉴权：知道「谁在用」，也是做配额与审计的前提
//   · 限流：保护自己与下游，防止被单点打爆
//   · 日志与指标：出问题时能定位，发布后能判断效果

// ---------- 1. 鉴权 ----------

export interface AuthOptions {
  /** 期望的令牌；不配置则表示开发模式，直接放行 */
  token?: string | undefined;
  /** 免鉴权路径（健康检查、静态资源） */
  publicPaths?: string[];
}

/**
 * Bearer Token 鉴权。
 * 生产环境建议放在网关统一做（OAuth / API Gateway），
 * 业务服务只读网关注入的用户信息头，避免每服务重复实现。
 */
export function authMiddleware({ token, publicPaths = [] }: AuthOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!token) {
      // 开发模式：不配令牌就不校验，但要在启动日志里明确提示
      next();
      return;
    }

    if (publicPaths.some((item) => req.path === item || req.path.startsWith(`${item}/`))) {
      next();
      return;
    }

    const header = req.headers.authorization ?? "";
    // SSE（EventSource）无法自定义请求头，因此额外支持查询参数传递令牌。
    // 风险：token 会出现在访问日志与浏览器历史里，所以生产环境应改用
    // 短时效的一次性令牌，或直接用 Cookie（同源时自动携带）。
    const queryToken = typeof req.query.token === "string" ? req.query.token : "";

    if (header !== `Bearer ${token}` && queryToken !== token) {
      res.status(401).json({
        success: false,
        message: "未授权：请在 Authorization 头中携带 Bearer <token>（SSE 可用 ?token=）",
      });
      return;
    }

    next();
  };
}

// ---------- 2. 限流（固定窗口 + 令牌桶思路） ----------

export interface RateLimitOptions {
  /** 窗口时长（毫秒） */
  windowMs: number;
  /** 每个窗口允许的请求数 */
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 按客户端 IP 做固定窗口限流。
 * 注意：单实例内存实现，多实例部署时要换成 Redis 等共享存储，
 * 否则实际限额会随实例数放大。
 */
export function rateLimitMiddleware({ windowMs, max }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        success: false,
        message: `请求过于频繁，请在 ${retryAfter} 秒后重试`,
      });
      return;
    }

    bucket.count += 1;
    next();
  };
}

// ---------- 3. 日志与指标 ----------

/**
 * 请求日志：把「谁、做了什么、耗时多少、结果如何」写进日志，
 * 同时把样本喂给指标注册表，供 /api/metrics 聚合。
 */
export function requestLogMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // SSE 是长连接，必须在响应结束时统计，否则会把“连接时长”算成“请求耗时”
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const route = normalizeRoute(req.path);

      metrics.record({
        route,
        method: req.method,
        status: res.statusCode,
        durationMs,
        at: new Date().toISOString(),
      });

      console.log(
        `[${req.method}] ${route} -> ${res.statusCode} ${durationMs}ms` +
          (res.statusCode >= 400 ? "  ⚠" : "")
      );
    });

    next();
  };
}

/** 统一错误处理：把未捕获异常转成结构化响应，并记录日志 */
export function errorHandler() {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[error] ${req.method} ${req.path}：${message}`);

    if (res.headersSent) {
      // SSE 等场景已经写过头了，只能中断连接
      res.end();
      return;
    }

    res.status(500).json({ success: false, message: "服务内部错误" });
  };
}
