import { runAgent } from "./agent-graph.js";

// Agent 服务层：对外屏蔽 LangGraph 细节，只暴露 chat(question)
// 后续 server.ts / agent-service 都通过它调用 Agent。

export async function chat(question: string): Promise<string> {
  const normalizedQuestion = question.trim();

  if (!normalizedQuestion) {
    throw new Error("问题不能为空");
  }

  return runAgent(normalizedQuestion);
}
