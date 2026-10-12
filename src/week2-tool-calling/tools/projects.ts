import { z } from "zod";
import { tool } from "@langchain/core/tools";

// 模拟项目库，对应“检索项目列表”的业务场景

interface Project {
  id: string;
  name: string;
  status: "进行中" | "已交付" | "已暂停";
  owner: string;
}

const projects: Project[] = [
  { id: "P1001", name: "智慧园区设施管理平台", status: "进行中", owner: "小林" },
  { id: "P1002", name: "设备巡检管理系统", status: "已交付", owner: "小王" },
  { id: "P1003", name: "园区能耗数据大屏", status: "进行中", owner: "小张" },
  { id: "P1004", name: "空调节能改造分析", status: "已暂停", owner: "小林" },
];

export const listProjectsTool = tool(
  async ({ keyword }) => {
    const matched = keyword
      ? projects.filter((project) => project.name.includes(keyword))
      : projects;

    return JSON.stringify({ total: matched.length, projects: matched });
  },
  {
    name: "list_projects",
    description: "检索项目列表，可传关键字按名称过滤，返回项目 ID、名称、状态与负责人。",
    schema: z.object({
      keyword: z.string().optional().describe("项目名称关键字，不传则返回全部"),
    }),
  }
);

export const getProjectDetailTool = tool(
  async ({ projectId }) => {
    const project = projects.find((item) => item.id === projectId);

    if (!project) {
      return JSON.stringify({ projectId, error: "未找到对应项目" });
    }

    return JSON.stringify(project);
  },
  {
    name: "get_project_detail",
    description: "按项目 ID 查询单个项目的详细信息。",
    schema: z.object({
      projectId: z.string().describe("项目 ID，例如 P1001"),
    }),
  }
);
