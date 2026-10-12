// 学习目标：权限校验
// 不依赖模型的自觉：在“执行工具之前”按角色做硬校验，防止越权调用。

export type Role = "viewer" | "operator" | "admin";

const READ_TOOLS = [
  "get_weather",
  "list_projects",
  "get_project_detail",
  "get_business_metric",
  "query_devices",
];

const WRITE_TOOLS = ["update_device_status"];

const rolePermissions: Record<Role, string[]> = {
  viewer: READ_TOOLS,
  operator: [...READ_TOOLS, ...WRITE_TOOLS],
  admin: ["*"],
};

export function canUseTool(role: Role, toolName: string): boolean {
  const allowed = rolePermissions[role];
  return allowed.includes("*") || allowed.includes(toolName);
}

/** 按角色过滤可见工具，从源头上避免模型“看到”不该用的工具 */
export function filterToolsByRole<T extends { name: string }>(role: Role, tools: T[]): T[] {
  return tools.filter((item) => canUseTool(role, item.name));
}

/** 执行前的兜底校验 */
export function assertToolAllowed(role: Role, toolName: string): void {
  if (!canUseTool(role, toolName)) {
    throw new Error(`越权访问：角色「${role}」无权调用工具「${toolName}」`);
  }
}
