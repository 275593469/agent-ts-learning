# 第 7 周：评估、安全与性能

## 学习内容
离线测试集、工具调用准确率、提示词注入防护、权限校验、Token 预算、日志追踪。

## 文件说明

| 文件 | 知识点 |
| --- | --- |
| `eval-dataset.ts` | 离线测试集：正常场景 / 参数细节 / 无需工具 / 注入场景 |
| `injection-guard.ts` | 注入特征检测、外部内容隔离、安全系统提示词模板 |
| `permission.ts` | 角色 → 工具权限映射、按角色过滤工具、执行前硬校验 |
| `token-budget.ts` | Token 估算、预算累计与超限断言 |
| `trace-logger.ts` | 结构化执行轨迹（模型/工具/安全事件 + 耗时） |
| `eval-runner.ts` | 串起上述能力：注入检测 → 权限过滤 → 工具调用 → 准确率统计 → 预算 → 轨迹 |
| `eval-dataset-extended.ts` | 22 条用例，覆盖 normal / edge / no_tool / safety 四类并打标签 |
| `regression-compare.ts` | 与基线逐条 diff：回归 / 修复 / 仍未通过，分维度通过率，有回归则退出码 1 |
| `prompt-injection-suite.ts` | 给安全规则本身写测试：拦截率 + 误伤率 + 漏检清单（纯本地） |
| `cost-guard.ts` | 成本守卫：按预算比例分档降级（压缩上下文 → 限长 → 拒绝） |
| `trace-report.ts` | 轨迹聚合报告：模型/工具耗时占比、最慢步骤 Top3、错误与拦截统计 |

## 运行

```bash
npm run week7:eval
npm run week7:injection        # 纯本地，无需模型
npm run week7:trace            # 纯本地，无需模型
npm run week7:cost
EVAL_LIMIT=6 npm run week7:regression   # 限制用例数，省调用
```

输出包含：
- 工具调用准确率、参数准确率
- 越权场景（viewer 调用写工具）被拒绝
- 执行轨迹与 Token 预算快照
- 注入拦截率 / 误伤率、成本降级档位、链路耗时占比

## 本周成果
为已有 Agent 写测试用例、记录执行轨迹、覆盖异常与越权场景。
