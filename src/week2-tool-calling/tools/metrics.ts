import { z } from "zod";
import { tool } from "@langchain/core/tools";

// 模拟业务指标接口，对应“查业务指标”的场景

const metricData: Record<string, Record<string, { value: number; unit: string }>> = {
  能耗: {
    本月: { value: 128.6, unit: "万千瓦时" },
    上月: { value: 119.4, unit: "万千瓦时" },
  },
  故障率: {
    本月: { value: 1.8, unit: "%" },
    上月: { value: 2.3, unit: "%" },
  },
  设备在线率: {
    本月: { value: 96.5, unit: "%" },
    上月: { value: 94.1, unit: "%" },
  },
};

export const getBusinessMetricTool = tool(
  async ({ metric, period }) => {
    const record = metricData[metric]?.[period];

    if (!record) {
      return JSON.stringify({ metric, period, error: "暂无该指标数据" });
    }

    return JSON.stringify({ metric, period, ...record });
  },
  {
    name: "get_business_metric",
    description: "查询园区业务指标，支持能耗、故障率、设备在线率，按本月/上月查询。",
    schema: z.object({
      metric: z.enum(["能耗", "故障率", "设备在线率"]),
      period: z.enum(["本月", "上月"]),
    }),
  }
);
