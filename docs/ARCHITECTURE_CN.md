# CyberStrikeAI 工程架构概览

> 本文档基于源码梳理，供开发者快速理解项目结构与核心模块。

---

## 技术栈总览

| 层次 | 技术选型 |
|------|----------|
| 语言 | Go 1.25（后端主体）+ 原生 JavaScript（前端）+ Python（工具脚本）|
| AI 框架 | CloudWeGo Eino ADK v0.9.21（Agent 编排 / Chain / ReAct）|
| 模型协议 | OpenAI 兼容 / Anthropic Claude（Eino ext 模型组件）|
| HTTP 框架 | Gin v1.9.1（支持 TLS / HTTP2 / SSE 流式 / WebSocket）|
| 数据库 | SQLite（mattn/go-sqlite3，CGO），会话库与知识库可分离部署 |
| 工具协议 | MCP（Model Context Protocol）官方 Go SDK v1.3.1 |
| 前端 | 原生 JS + HTML 模板，无框架 / 无构建系统，vendor 库直接引入 |
| 可观测性 | OpenTelemetry v1.39 + Zap 结构化日志 |
| 部署 | 单二进制交付，Git fast-forward 自更新 + rebuild |

---

## 后端技术栈（Go）

| 领域 | 关键依赖 | 说明 |
|------|----------|------|
| Web 服务 | `gin-gonic/gin` | HTTP 路由、SSE 流式响应、中间件 |
| JSON 编解码 | `bytedance/sonic` | 高性能 JIT JSON 序列化 |
| AI Agent 编排 | `cloudwego/eino`、`eino-ext/adk`、`eino-ext/components/model/*` | ADK 主循环、agentic openai/claude 模型组件 |
| 文档/向量处理 | `eino-ext/components/document/*`、`embedding/openai` | Markdown/递归分块、文件加载、OpenAI Embedding |
| 工具协议 | `modelcontextprotocol/go-sdk` | 内置 MCP Server + External MCP 客户端 |
| 数据库 | `mattn/go-sqlite3` | 嵌入式 SQLite（WAL 模式，需 CGO）|
| Token 计数 | `pkoukk/tiktoken-go` | 上下文预算与 token 用量统计 |
| PTY 终端 | `creack/pty` | Web 终端 / 交互式命令执行 |
| 定时任务 | `robfig/cron/v3` | 任务调度、保留期清理 |
| 认证加密 | `golang.org/x/crypto`、JWT/Cookie | 会话认证、RBAC |
| 图像处理 | `disintegration/imaging` | 视觉分析图像预处理 |
| 二维码 | `skip2/go-qrcode` | 机器人接入二维码生成 |
| 配置 | `gopkg.in/yaml.v3` | 工具/角色/系统配置加载 |
| 机器人 SDK | `discordgo`、`slack-go/slack`、`larksuite/oapi-sdk-go`、`dingtalk-stream-sdk-go`、`tencent-connect/botgo` | 7 大平台消息接入 |
| 可观测性 | `go.opentelemetry.io/otel/*`、`go.uber.org/zap` | Trace 导出 + 结构化日志 |

> WebSocket 依赖 `gorilla/websocket`；底层 HTTP 客户端依赖 `go-resty/resty`；OpenAI/Anthropic 官方 SDK 作为间接依赖引入。

---

## 前端技术栈

**特点：零框架、零构建**。使用原生 JavaScript（ES Module）+ HTML 模板直接开发。前端按平台功能模块放在 `web/<module>/` 下，每个模块自带 `templates/` 与 `static/`：模板片段由 Gin 统一解析后通过 `{{template "<module>/<part>" .}}` 组合进 `web/core/templates/index.html` 壳层，静态资源按 `/static/<module>/...` 挂载。

| 类别 | 技术方案 |
|------|----------|
| 页面结构 | `web/core/templates/index.html`（壳层主入口）+ 各模块 `web/<module>/templates/*.html` 片段 |
| 样式 | 原生 CSS（`style.css`、`c2.css`、`mobile.css`），含移动端适配与主题切换 |
| 路由 | 自研 `router.js`（Hash 路由）|
| 国际化 | `i18next` + `i18n/*.json`（zh-CN / en-US / ru-RU）|
| Markdown 渲染 | `marked.min.js` + `DOMPurify`（sanitize-markdown.js）|
| 终端模拟 | `xterm.js` + fit addon（Web 终端）|
| 图表/关系图 | `cytoscape.min.js` + `elk.bundled.js`（攻击链 / 事实图自动布局）|
| 表格导出 | `xlsx.full.min.js`（资产 / 漏洞 Excel 导出）|
| 功能模块 | 按领域拆分的独立 JS（chat / c2 / assets / knowledge / hitl / monitor / projects / workflows / webshell / rbac / settings 等）|

---

## 数据库与存储

| 存储 | 技术 | 用途 |
|------|------|------|
| 会话库 | SQLite（`data/conversations.db`）| 对话历史、C2、RBAC、漏洞、资产、项目黑板、工具执行记录、工作流 |
| 知识库 | SQLite（`data/knowledge.db`）| RAG 向量索引与知识项（可与会话库分离部署）|
| 向量检索 | Eino Embedding + 自研 retriever | MultiQuery + 向量检索 + 精排 |
| 大输出落盘 | 本地文件系统（`data/conversation_artifacts`、工具输出）| 工具结果超阈值时全文落盘，上下文仅留预览 |
| 运行空间 | `storage` 模块 | 工作区 / 产物垃圾清理 |

> SQLite 通过 `mattn/go-sqlite3` 需 CGO 支持；开启 WAL 模式提升并发读写。

---

## AI / Agent 与大模型

| 维度 | 技术选型 |
|------|----------|
| 编排框架 | CloudWeGo Eino ADK（Deep / Plan-Execute / Supervisor / 单 Agent ReAct）|
| 模型接入 | OpenAI 兼容协议、Anthropic Claude（`agenticopenai` / `agenticclaude` 组件）|
| 多通道路由 | `internal/llm` 模型路由 + `eino_model_resilience` 重试 / Failover |
| 上下文管理 | `eino_agentic_summarize` 自动压缩 + `context_budget` Token 预算 |
| 工具调用 | 统一走 MCP 协议（内置 Server + External 客户端，含熔断限流）|
| Embedding | OpenAI 兼容 Embedding（知识库索引）|

---

## 工具与扩展生态

| 类型 | 技术 |
|------|------|
| 安全工具定义 | 声明式 YAML（`tools/*.yaml`，100+ 工具），executor 动态加载 |
| 工具脚本 | Python（`requirements.txt`：requests、httpx、impacket、bloodhound、angr、pwntools、mcp 等）|
| 独立 MCP Server | Go 实现（`mcp-servers/`）|
| 浏览器插件 | Chrome/Firefox Extension（Manifest V3，原生 JS/HTML）|
| Burp Suite 插件 | Java/Kotlin（Gradle + Maven 构建）|

---

## 部署与运维

| 方面 | 技术方案 |
|------|----------|
| 交付形态 | 单一 Go 二进制（内嵌前端静态资源）|
| 进程隔离 | Job Object（Windows）/ cgroup（Linux），`processguard` 模块 |
| 自更新 | Git fast-forward + rebuild + rollback（`update` 模块）|
| 启动脚本 | `run.sh` / `upgrade.sh`（Linux/macOS）|
| CI/CD | GitHub Actions（`.github/workflows/`：self-update、process-isolation、context-memory）|

---

## 入口与启动流程

```
cmd/server/main.go
    ├── 加载配置（config.Load / EnsureLocalConfig）
    ├── 进程隔离检查（processguard）
    ├── 初始化日志（logger）
    ├── 创建应用容器（app.New）
    └── 启动服务（application.RunWithContext，支持优雅关闭）
```

其他入口：
- `cmd/mcp-stdio/` — 以 stdio 方式运行 MCP Server
- `cmd/test-*/` — 本地调试辅助命令

---

## 核心模块目录结构

```
internal/
├── app/                  应用主容器（~2300 行），组装所有组件、注册 HTTP 路由
│   └── app.go            App struct：持有所有核心服务实例
│
├── config/               配置结构体定义与 YAML 加载
│   └── config.go         全局 Config struct（2600+ 行，涵盖所有子系统配置项）
│
├── database/             SQLite 数据访问层（66 个文件）
│   ├── database.go       DB 结构体与初始化（迁移、schema 版本管理）
│   ├── conversation.go   对话历史存储（1800+ 行）
│   ├── c2.go             C2 会话 / 监听器 / 任务持久化
│   ├── rbac.go           用户 / 角色 / 权限（RBAC）
│   ├── vulnerability.go  漏洞管理
│   ├── asset.go          资产管理（1300+ 行）
│   ├── project.go        项目黑板（跨对话事实存储）
│   ├── monitor.go        工具执行记录
│   └── workflow.go       可视化工作流定义
│
├── handler/              HTTP API Handler（146 个文件）
│   ├── agent.go          单 Agent 对话入口（SSE 流式）
│   ├── eino_single_agent.go  Eino 单 Agent 模式
│   ├── multi_agent.go    多 Agent（Deep / Plan-Execute / Supervisor）
│   ├── c2.go             C2 REST API（监听器 / Beacon / 任务）
│   ├── hitl*.go          人机协同审批流（8 个文件）
│   ├── asset.go          资产管理 API
│   ├── knowledge.go      知识库管理 API
│   ├── fofa.go           网络空间测绘（FOFA / ZoomEye / Quake / Shodan）
│   ├── config.go         系统设置 API（2900+ 行）
│   ├── openapi.go        OpenAPI 文档生成（6600 行）
│   ├── batch_task_manager.go  批量任务队列调度（1400+ 行）
│   └── robot.go          机器人 Webhook 接入（2000 行）
│
├── agent/                单 Agent ReAct 循环实现
│   └── agent.go          与 OpenAI API / MCP Server 交互的主循环
│
├── multiagent/           Eino 多 Agent 适配层（211 个文件，最大子模块）
│   ├── eino_adk_run_loop.go          Deep / Supervisor / Plan-Execute 主循环
│   ├── eino_middleware.go             Eino 中间件链（reduction / tool_search / plantask）
│   ├── eino_model_resilience.go      模型层重试 / Failover
│   ├── eino_agentic_*                Agent 适配器（Model / Tool / Event）
│   ├── eino_agentic_summarize.go     上下文压缩（Summarization）
│   └── context_budget.go             Token 预算管控
│
├── mcp/                  MCP 协议实现层
│   ├── server.go         内置 MCP Server：工具注册 / 路由 / 调用（1700+ 行）
│   ├── external_manager.go  外部 MCP 客户端连接池（并发限流 + 熔断）
│   ├── execution_service.go   工具异步执行（支持 wait_tool_execution）
│   └── types.go          MCP 核心类型定义
│
├── security/             安全执行层
│   ├── executor.go       Shell / 命令工具执行器（带输出截断、无输出超时保护）
│   ├── auth.go           会话认证管理（JWT / Cookie）
│   └── rbac*.go          RBAC 权限判断
│
├── c2/                   内置 C2 系统
│   ├── manager.go        C2 统一门面（Listener 注册 / 任务入队 / 事件总线）
│   ├── listener*.go      多协议 Listener 实现（HTTP / DNS / SMB 等）
│   ├── beacon*.go        Beacon 生命周期管理
│   └── session*.go       会话状态机
│
├── knowledge/            RAG 知识库
│   ├── manager.go        知识项 CRUD（扫描目录 / 入库）
│   ├── indexer.go        Eino Compose 链索引（分块 → Embedding → 写入向量）
│   ├── retriever.go      MultiQuery + 向量检索 + 精排流水线
│   └── embedder.go       OpenAI 兼容 Embedding 客户端
│
├── hitl/                 人机协同服务层（审批模式 / 审查编辑模式）
│   └── service.go        HITL 配置与保留策略
│
├── audit/                平台操作审计（不记录对话正文）
│   └── service.go        审计事件写入 + 保留期清理
│
├── monitor/              MCP 工具调用监控与执行记录
│   └── execution_reconciler.go  启动时修复卡住的 running 记录
│
├── project/              项目黑板（跨对话事实共享）
│   └── fact*.go          事实（Fact）upsert / 检索 / 关系图
│
├── workflow/             可视化工作流引擎
│   └── engine.go         DAG 执行（节点类型：Agent / Tool / Condition）
│
├── robot/                机器人接入（7 个平台）
│   ├── wechat.go         微信 iLink / 企业微信
│   ├── dingtalk.go       钉钉 Stream SDK
│   ├── lark.go           飞书长连接
│   ├── telegram.go       Telegram 长轮询
│   ├── slack.go          Slack Socket Mode
│   ├── discord.go        Discord Gateway
│   └── qq.go             QQ 官方机器人
│
├── update/               一键自更新（git fast-forward + rebuild + rollback）
│   └── updater.go        核心更新逻辑
│
├── toolguard/            调用拦截规则引擎（正则白名单，如 .gov 域名保护）
│
├── skillpackage/         Eino Skills 技能包加载（SKILL.md + 附属文件）
│
├── storage/              运行空间垃圾清理（工作区 / 工具输出 / C2 产物）
│
├── processguard/         进程隔离（Windows Job Object / Linux cgroup）
│
├── einoobserve/          Eino OpenTelemetry Span 映射
│
├── llm/                  模型路由（多通道选择）
│
├── openai/               OpenAI 协议底层 HTTP 客户端
│
├── vision/               视觉分析（analyze_image MCP 工具）
│
├── attackchain/          攻击链建模（漏洞 → 资产 → 任务关联图）
│
├── agentfinalizer/       Agent 结论最终化（执行结束后自动总结）
│
├── reasoning/            推理链管理
│
├── einomcp/              Eino ↔ MCP Tool 适配桥接
│
├── authctx/              请求 context 中携带的用户身份信息
│
├── termout/              终端启动信息输出美化
│
├── logger/               Zap 日志初始化
│
├── monitor/              执行记录监控
│
├── runlease/             运行租约（防止并发重复启动同一任务）
│
├── tooloutput/           工具输出格式化
│
├── typesafe/             TypeSafe Jev 审计后端（结构化放通/拦截）
│
└── projectprompt/        项目级系统提示词注入
```

---

## 配置目录说明

| 目录 | 说明 |
|------|------|
| `tools/*.yaml` | 100+ 安全工具定义（Nmap、SQLMap、Metasploit 等），executor 动态加载 |
| `roles/*.yaml` | 角色定义，绑定工具集与专属提示词 |
| `agents/*.md` | 多 Agent 子 Agent Markdown 定义（YAML front matter + 系统提示词正文）|
| `skills/` | Eino 技能包（每个子目录包含 `SKILL.md`）|
| `mcp-servers/` | 独立外部 MCP Server 实现（Go 语言）|
| `knowledge_base/` | 本地知识库文件（Markdown）|
| `web/core/` | 壳层与通用能力：页面骨架、登录、导航、i18n、vendor、通用样式 |
| `web/<module>/` | 业务模块（dashboard / chat / security / assets / projects / vulnerabilities / tasks / workflows / webshell / c2 / mcp / skills / tools / agents / roles / knowledge / rbac / settings / api-docs），各自包含 `templates/` 与 `static/` |
| `plugins/` | 浏览器插件（Chrome / Firefox）和 Burp Suite 插件 |
| `internal/c2/listeners/` | C2 多协议 Listener 实现 |

---

## 数据流架构

```
用户输入（Web / 机器人）
         ↓
    Handler（SSE / REST）
         ↓
  Eino ADK / Agent（ReAct 循环）
         ↓ tool_call
  MCP Server（内置）/ External MCP（远程）
         ↓
  Security Executor（进程隔离，Shell 命令执行）
         ↓ 结果
  流式返回前端（SSE）+ 写入 SQLite（证据沉淀）
```

---

## Agent 模式说明

| 模式 | 说明 | 代码入口 |
|------|------|----------|
| `eino_single` | Eino 单 Agent ReAct 循环 | `handler/eino_single_agent.go` |
| `deep` | Deep 多 Agent（主 Agent + 子 Agent task 调用）| `multiagent/eino_adk_run_loop.go` |
| `plan_execute` | Plan-Execute-Replan 循环 | 同上 |
| `supervisor` | Supervisor 模式（Agent 间 transfer）| 同上 |

---

## 多 Agent 配置文件（agents/）

```
agents/
├── orchestrator.md                Deep 主 Agent（kind: orchestrator）
├── orchestrator-plan-execute.md   Plan-Execute 主 Agent
├── orchestrator-supervisor.md     Supervisor 主 Agent
├── recon.md                       信息收集子 Agent
├── privilege-escalation.md        权限提升子 Agent
├── lateral-movement.md            横向移动子 Agent
├── persistence-maintenance.md     持久化子 Agent
├── impact-exfiltration.md         影响扩大子 Agent
└── ...（共 16 个角色定义）
```

每个 `.md` 文件结构：
```markdown
---
name: recon
description: 信息收集子 Agent
tools: [nmap, subfinder, nuclei]
bind_role: 信息收集
max_iterations: 50
---
（正文为系统提示词）
```

---

## HITL 人机协同模式

| 模式 | 说明 |
|------|------|
| `off` | 关闭审批，工具直接执行 |
| `approval` | 审批模式：非白名单工具需人工或审计 Agent 放行 |
| `review_edit` | 审查编辑模式：审计 Agent 可修改参数后放行 |

审批方：`human`（人工）或 `audit_agent`（LLM 审计 Agent，支持 OpenAI 兼容后端或 TypeSafe Jev）

---

## 一键更新机制

```bash
# 检查是否有新版本
./cyberstrike-ai --check-update

# 执行更新（git fast-forward + rebuild）
./cyberstrike-ai --update

# 回滚到更新前版本
./cyberstrike-ai --update-rollback
```

更新源默认为官方 GitHub 仓库，可在 `config.yaml` 的 `update.repo` 字段改为镜像或二开仓库。

---

## 关键设计特点

1. **工具即 YAML**：`tools/*.yaml` 声明式定义工具，无需修改 Go 代码即可扩展工具集
2. **MCP 原生**：内置 MCP Server + External MCP 客户端，工具统一走 MCP 协议调用
3. **熔断限流**：外部 MCP Server 支持并发数限制（per-server + global）和连续失败熔断
4. **大输出落盘**：工具结果超过阈值（默认 100KB）时全文写入本地文件，上下文只留预览路径
5. **上下文压缩**：Eino Summarization 中间件在 token 接近上限时自动压缩历史
6. **进程隔离**：工具执行通过 Job Object（Windows）/ cgroup（Linux）限制资源
7. **证据沉淀**：所有工具调用结果写入 SQLite `tool_executions` 表，可审计回溯
