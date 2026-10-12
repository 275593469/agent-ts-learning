import { z } from "zod";
import { tool } from "@langchain/core/tools";

// 模拟天气接口，返回结构固定，方便模型理解

interface WeatherInfo {
  condition: string;
  temperature: number;
  humidity: number;
}

const weatherData: Record<string, WeatherInfo> = {
  北京: { condition: "晴", temperature: 24, humidity: 35 },
  上海: { condition: "多云", temperature: 27, humidity: 65 },
  深圳: { condition: "小雨", temperature: 30, humidity: 80 },
};

export const getWeatherTool = tool(
  async ({ city }) => {
    const data = weatherData[city];

    if (!data) {
      return JSON.stringify({ city, error: `暂无 ${city} 的天气数据` });
    }

    return JSON.stringify({ city, ...data });
  },
  {
    name: "get_weather",
    description: "查询指定城市的实时天气（天气状况、温度、湿度）。",
    schema: z.object({
      city: z.enum(["北京", "上海", "深圳"]).describe("要查询天气的城市"),
    }),
  }
);
