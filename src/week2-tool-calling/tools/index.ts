import { getWeatherTool } from "./weather.js";
import { listProjectsTool, getProjectDetailTool } from "./projects.js";
import { getBusinessMetricTool } from "./metrics.js";

// 统一的工具注册表：后续 Agent 直接 bind 这个数组即可
export const tools = [
  getWeatherTool,
  listProjectsTool,
  getProjectDetailTool,
  getBusinessMetricTool,
];

export { getWeatherTool, listProjectsTool, getProjectDetailTool, getBusinessMetricTool };
