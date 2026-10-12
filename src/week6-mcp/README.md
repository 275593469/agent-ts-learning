# 第 6 周：MCP 与工具生态

## 学习内容
MCP Client / Server、工具发现、资源与提示模板、访问授权。

## 文件说明

| 文件 | 知识点 |
| --- | --- |
| `mcp-server.ts` | MCP Server：注册 Tools / Resources / Prompts，写操作做令牌鉴权 |
| `mcp-client.ts` | MCP Client：工具发现与调用、读取资源、获取提示模板，并转成 LangChain 工具交给模型 |
| `mcp-weather-server.ts` | 第二个 Server（天气）：工具 + 资源 + 提示模板，声明资源订阅能力 |
| `mcp-multi-server.ts` | 聚合多个 Server：工具前缀、按来源做权限过滤、并行调用跨 Server 工具 |
| `mcp-resource-client.ts` | 资源发现（listResources/Templates）、读取、订阅与变更通知 |
| `mcp-http-server.ts` | HTTP 传输（Streamable HTTP）：无状态模式 + Bearer 鉴权 |
| `mcp-http-client.ts` | HTTP 传输客户端：连接长驻服务、鉴权失败对照 |

## 运行

```bash
npm install            # 安装 @modelcontextprotocol/sdk、@langchain/mcp-adapters
npm run week6:mcp
npm run week6:mcp-multi
npm run week6:mcp-resources                     # 加 MCP_RESOURCE_TICK=1 可看到订阅推送
npm run week6:mcp-http-server                   # 另开终端
npm run week6:mcp-http-client
```

## 说明
- Server 通过 **stdio** 传输，由 Client 以子进程方式拉起，启动命令为 `npx tsx src/week6-mcp/mcp-server.ts`。
- stdio 模式下 **不要** 用 `console.log` 输出日志（会污染协议通道），请用 `console.error`。
- 写操作 `update_device_status` 需要 `MCP_AUTH_TOKEN=demo-token`，用于演示访问授权。
- HTTP 版默认监听 `127.0.0.1:3100`，鉴权令牌同样取 `MCP_AUTH_TOKEN`（默认 `demo-token`）。

## 本周成果
把现有业务查询接口封装成 MCP 工具，并接入大模型使用。
