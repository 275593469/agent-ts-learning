import "dotenv/config";
import path from "node:path";
import express from "express";
import cors from "cors";
import { chat } from "../week3-agent-loop/agent-service.js";
import { streamChat, streamTask } from "./sse.js";
import { taskStore } from "./task-progress.js";
import { metrics } from "./metrics.js";
import {
  authMiddleware,
  errorHandler,
  rateLimitMiddleware,
  requestLogMiddleware,
} from "./middleware.js";

// 第 8 周交付物：可演示、可测试、可部署的完整业务 Agent 平台（后端）
// 启动：npm run dev（前端页面在 public/index.html）
//   GET  /                      演示页（SSE 流式对话 + 任务进度 + 指标面板）
//   GET  /api/health            健康检查
//   GET  /api/metrics           服务指标（请求量、错误率、P95 延迟、SSE 连接数）
//   POST /api/chat              同步对话（走 Agent）
//   GET  /api/chat/stream       SSE 流式对话
//   POST /api/tasks             创建后台任务
//   GET  /api/tasks/:id/stream  SSE 订阅任务进度
// 鉴权：配置 API_TOKEN 后开启（Authorization: Bearer <token>，SSE 用 ?token=）
// 限流：默认每 IP 每分钟 120 次，可用 RATE_LIMIT_PER_MINUTE 覆盖

const app = express();
const port = Number(process.env.PORT ?? 3000);
const apiToken = process.env.API_TOKEN;
const publicDir = path.resolve(process.cwd(), "public");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// 观测与防护：先记录日志/指标，再鉴权，最后限流
app.use(requestLogMiddleware());
app.use("/api", authMiddleware({ token: apiToken, publicPaths: ["/health"] }));
app.use(
  rateLimitMiddleware({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
  })
);

if (!apiToken) {
  console.warn("提示：未配置 API_TOKEN，当前为开发模式（接口不校验鉴权）");
}

// ---------- 健康检查 ----------
app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "Agent API is running" });
});

// ---------- 服务指标 ----------
app.get("/api/metrics", (_req, res) => {
  res.json({ success: true, data: metrics.snapshot() });
});

// ---------- 同步对话（Agent） ----------
app.post("/api/chat", async (req, res) => {
  const { question } = req.body ?? {};

  if (typeof question !== "string" || !question.trim()) {
    res.status(400).json({ success: false, message: "question 必须是非空字符串" });
    return;
  }

  try {
    const answer = await chat(question);
    res.json({ success: true, data: { answer } });
  } catch (error) {
    console.error("Agent 调用失败：", error);
    res.status(500).json({ success: false, message: "Agent 处理失败，请稍后重试" });
  }
});

// ---------- SSE 流式对话 ----------
app.get("/api/chat/stream", async (req, res) => {
  const question = typeof req.query.question === "string" ? req.query.question : "";

  if (!question.trim()) {
    res.status(400).json({ success: false, message: "question 不能为空" });
    return;
  }

  await streamChat(res, question);
});

// ---------- 后台任务：创建 ----------
app.post("/api/tasks", (req, res) => {
  const { name } = req.body ?? {};
  const taskId = `task-${Date.now()}`;

  taskStore.create(taskId);
  metrics.taskCreated();
  res.json({ success: true, data: { taskId } });

  // 模拟一个后台长任务：分步推进并实时产出进度
  runDemoTask(taskId, typeof name === "string" && name ? name : "楼宇能耗批量分析");
});

// ---------- 后台任务：订阅进度 ----------
app.get("/api/tasks/:taskId/stream", (req, res) => {
  const { taskId } = req.params;

  if (!taskId) {
    res.status(400).json({ success: false, message: "taskId 不能为空" });
    return;
  }

  streamTask(res, taskId);
});

// ---------- 静态资源与演示页 ----------
// 前端放在 public/ 下，构建产物不参与编译（tsc 只处理 TS），因此用 cwd 定位
app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

/** 模拟后台任务：实际项目中替换为真实的 Agent 批量执行逻辑 */
function runDemoTask(taskId: string, name: string): void {
  const steps = ["加载数据", "清洗校验", "指标计算", "生成报告"];
  const total = steps.length;

  taskStore.emit(taskId, {
    step: "start",
    status: "running",
    progress: 0,
    message: `任务「${name}」已启动`,
  });

  steps.forEach((step, index) => {
    setTimeout(() => {
      const isLast = index === total - 1;

      taskStore.emit(taskId, {
        step,
        status: isLast ? "succeeded" : "running",
        progress: Math.round(((index + 1) / total) * 100),
        message: `${step}完成`,
      });
    }, 800 * (index + 1));
  });
}

// 统一错误处理必须放在所有路由之后
app.use(errorHandler());

app.listen(port, () => {
  console.log(`Agent API 已启动：http://localhost:${port}`);
  console.log(`演示页：http://localhost:${port}/（静态目录 ${publicDir}）`);
  console.log(`指标：http://localhost:${port}/api/metrics`);
});
