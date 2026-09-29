# v0.2.1 MCP 名称校验修复与发布验收

2026-09-30（北京时间）。目录创建和重命名的非空白校验改为共享服务端 Zod refinement；工具 JSON Schema 保留 1–500 的字符串长度限制，不再发布连接器误判的 `\S` pattern。合法名称保持原样，幂等输入不变，无数据库迁移。

## 版本与部署

- [PR #4](https://github.com/TANG617/Acornary/pull/4) 已合入 main；提交 `f71c9da12e6817013b6878b7e3ce8a4fa452f6c6`，附注标签 `v0.2.1`。
- [分支 CI](https://github.com/TANG617/Acornary/actions/runs/36595236046)、[PR CI](https://github.com/TANG617/Acornary/actions/runs/36595313054) 和 [main CI](https://github.com/TANG617/Acornary/actions/runs/36596021398) 均通过。
- [Release](https://github.com/TANG617/Acornary/actions/runs/36596053644) 的 identity、test、publish、deploy 全部成功。
- 镜像为 `ghcr.io/tang617/acornary@sha256:821f4bc50bbdec67631a4f90ee65a2df35964f40976c42aceb9bd44372d458b8`；已核对公开镜像索引及 linux/amd64 manifest。
- 服务器任务 `dc0d0110196e8db68838aa38` 为 `succeeded`；公网 `/health` 返回 `status=ok`、`version=v0.2.1` 和上述完整 commit。匿名 `/mcp` 与 `/api/context` 仍返回 401。

## 自动化与真实连接器验收

- Node 24 类型检查、51 项 Vitest、生产构建、17 项云模式 Chromium 测试及改动文件的 Prettier 检查通过；GitHub 另完成发布控制器与真实 PostgreSQL 迁移／恢复检查。
- 名称契约覆盖中文、英文、混合字符、首尾空白、换行、长度边界，以及空串、纯空白和超长名称拒绝。真实 Streamable HTTP 测试覆盖创建／重命名的 `tools/list` schema、中文写入、原样保存、幂等重试和非法名称拒绝。
- 部署前后、真实入库之前，原 Acornary App 连接读取的 17 条物品记录、13 条目录记录及相应查询响应完全一致。
- 部署后原 App 连接仍报告旧 `\S` pattern，确认连接器保留了旧工具定义。在已登录的 ChatGPT 中打开 Plugins → Acornary → Manage → Refresh tools 后，同一个 Acornary App 工具成功完成用户已授权的中文目录与物品创建。
- 已回读该物品的名称、容纳路径、到期日及唯一 CREATE 事件，按名称查询只有 1 个实例。没有为验收额外创建测试库存，也没有修改连接器权限或重新授权。

## 后续发布注意事项

工具输入 schema 发生变化时，服务部署成功不代表已有连接器已获取新定义。应刷新现有连接器的工具定义，并通过该连接器实际验收；直接 MCP SDK 测试或公网健康检查不能替代这一环节。此次创建／重命名规则仍由共享领域服务执行，Web 与 MCP 均拒绝纯空白名称。
