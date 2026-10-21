# Web 前端模块化重构记录

本文记录 CyberStrikeAI Web 前端按「平台功能模块」重组 `web/` 目录的完整改造：背景、目标结构、模板与静态资源机制、后端与测试改动、验证结果，以及后续开发约定。

- 改造范围：`web/`、`internal/app/`（模板与静态加载）、前端测试与 CI、相关文档
- 兼容性：浏览器访问路径、页面行为、脚本加载顺序保持不变；HTTP 静态资源 URL 改为模块作用域
- 技术前提不变：原生 JavaScript + HTML 模板，零框架、零打包

---

## 一、改造背景

改造前的前端是「一个巨型模板 + 一个扁平静态目录」：

| 项 | 改造前 | 问题 |
|----|--------|------|
| 页面模板 | `web/templates/index.html`（约 723 KB / 7179 行） | 30 个页面、近 30 个弹窗全在一个文件，改动冲突高、定位困难 |
| 静态脚本 | `web/static/js/` 平铺 88 个文件（含 45 个 `.test.cjs`） | 业务脚本、通用能力、测试、vendor 混在一起，归属不清 |
| 样式 | `web/static/css/` 平铺 6 个文件 | 无法体现「某个样式属于哪个模块」 |
| 资源 URL | 全部为 `/static/js/...`、`/static/css/...` | 无法按模块做缓存/隔离，也无法判断引用归属 |

目标：按左侧导航的功能边界拆分，每个模块自带 `templates/` 与 `static/`，模块内自洽、模块间低耦合。

---

## 二、改造后的目录结构

```
web/
├── core/                       壳层与通用能力
│   ├── templates/index.html    页面骨架（login/顶栏/侧边栏/content-area/脚本装配）
│   └── static/
│       ├── js/                 router, i18n, theme, auth, modal, notifications,
│       │                       sanitize-markdown, token-usage, rbac-guards,
│       │                       mobile-ui, builtin-tools, test-utils.cjs
│       ├── css/                style.css, mobile.css
│       ├── i18n/               zh-CN.json, en-US.json, ru-RU.json
│       ├── vendor/             marked, purify, cytoscape, elk, xlsx, xterm, i18next
│       └── favicon.ico / logo.png / site.webmanifest
├── api-docs/
├── dashboard/
├── chat/
├── security/                   hitl + tool-guard
├── assets/                     资产概览 / 资产库 / 信息收集
├── projects/
├── vulnerabilities/
├── tasks/
├── workflows/
├── webshell/
├── c2/                         监听器 / 会话 / 任务 / Payload / 事件 / Profile
├── mcp/
├── skills/
├── tools/
├── agents/
├── roles/
├── knowledge/
├── rbac/                       平台权限
└── settings/                   系统设置（含一键更新、Token、审计、存储、终端、机器人）
```

每个模块的固定布局：

```
web/<module>/
├── templates/<module>_<part>.html   {{define "<module>/<part>"}} ... {{end}}
└── static/
    ├── js/                          该模块的脚本与同目录测试
    └── css/                         该模块独有的样式（无则省略）
```

规模：**20 个模块目录、56 个模板文件、44 个脚本（含 1 个测试工具）、45 个 `.test.cjs`、6 个样式表**。

---

## 三、模块清单

| 模块 | 承载页面 | 模板文件 | 脚本 | 样式 |
|------|----------|----------|------|------|
| `core` | 壳层（登录、顶栏、侧边栏、脚本装配） | `index.html` | router / i18n / theme / auth / modal / notifications / sanitize-markdown / token-usage / rbac-guards / mobile-ui / builtin-tools / test-utils.cjs | `style.css`、`mobile.css` |
| `dashboard` | `page-dashboard` | `dashboard_page.html` | dashboard.js | — |
| `chat` | `page-chat`、`page-chat-files`、会话右键菜单、聊天文件弹窗、攻击链弹窗 | `chat_page.html`、`chat_chat-files.html`、`chat_context-menu.html`、`chat_modals.html`、`chat_attack-chain-modal.html` | chat.js、chat-scroll.js、chat-plan-progress.js、chat-files.js、attack-chain-context.js | `chat-plan-progress.css` |
| `security` | `page-hitl`、`page-tool-guard`、HITL 日志弹窗 | `security_hitl.html`、`security_tool-guard.html`、`security_modals.html` | hitl.js、tool-guard.js | `tool-guard.css` |
| `assets` | `page-asset-overview`、`page-asset-library`、`page-info-collect`、6 个资产弹窗 | `assets_overview.html`、`assets_library.html`、`assets_info-collect.html`、`assets_modals.html` | assets.js、info-collect.js | — |
| `projects` | `page-projects`、项目列表菜单、项目/事实/事实详情弹窗 | `projects_page.html`、`projects_action-menu.html`、`projects_modals.html` | projects.js、fact-graph.js | — |
| `vulnerabilities` | `page-vulnerabilities`、漏洞编辑/复测弹窗 | `vulnerabilities_page.html`、`vulnerabilities_modals.html` | vulnerability.js | — |
| `tasks` | `page-tasks`、中断说明、批量管理/导入/队列/新增任务弹窗 | `tasks_page.html`、`tasks_interrupt-modal.html`、`tasks_batch-manage-modal.html`、`tasks_batch-modals.html` | tasks.js | — |
| `workflows` | `page-workflows`、元信息/试运行/AI 生成/包导入/包覆盖弹窗 | `workflows_page.html`、`workflows_modals.html` | workflows.js、workflow-package-client.js | — |
| `webshell` | `page-webshell`、连接编辑弹窗 | `webshell_page.html`、`webshell_modals.html` | webshell.js | — |
| `c2` | `page-c2-listeners` / `sessions` / `tasks` / `payloads` / `events` / `profiles`、C2 通用弹窗 | `c2_listeners.html`、`c2_sessions.html`、`c2_tasks.html`、`c2_payloads.html`、`c2_events.html`、`c2_profiles.html`、`c2_modals.html` | c2.js | `c2.css` |
| `mcp` | `page-mcp-monitor`、`page-mcp-management`、工具调用详情/终止/外部 MCP 弹窗 | `mcp_monitor.html`、`mcp_management.html`、`mcp_detail-modal.html`、`mcp_modals.html` | monitor.js | — |
| `skills` | `page-skills-monitor`、`page-skills-management`、Skill 编辑弹窗 | `skills_monitor.html`、`skills_management.html`、`skills_modals.html` | skills.js | — |
| `tools` | `page-tools-status`、`page-tools-management`、工具配置弹窗 | `tools_status.html`、`tools_management.html`、`tools_modals.html` | tools.js | — |
| `agents` | `page-agents-management`、Agent Markdown 弹窗 | `agents_page.html`、`agents_modals.html` | agents.js | — |
| `roles` | `page-roles-management`、角色选择/角色编辑弹窗 | `roles_page.html`、`roles_modals.html` | roles.js | — |
| `knowledge` | `page-knowledge-management`、`page-knowledge-retrieval-logs`、知识条目弹窗 | `knowledge_management.html`、`knowledge_retrieval-logs.html`、`knowledge_modals.html` | knowledge.js | — |
| `rbac` | `page-platform-rbac`、成员/角色弹窗 | `rbac_page.html`、`rbac_modals.html` | rbac.js | — |
| `settings` | `page-settings`、机器人账号绑定弹窗 | `settings_page.html`、`settings_modals.html` | settings.js、audit.js、audit-datetime-picker.js、storage.js、terminal.js、wechat-robot.js、update.js | — |
| `api-docs` | `/api-docs` 独立页面 | `api-docs.html` | api-docs.js | `api-docs-mobile.css` |

---

## 四、模板机制

### 4.1 片段定义与组合

每个片段文件只包含一个 `{{define}}` 块，名称为 `<module>/<part>`：

```html
{{define "chat/chat-files"}}
<div id="page-chat-files" class="page">
  ...
</div>
{{end}}
```

壳层 `web/core/templates/index.html` 在原位置引入片段，保持改动前的 DOM 顺序：

```html
<div class="content-area">
    <!-- 仪表盘页面 -->
    {{template "dashboard/page" .}}
    <!-- 对话页面 -->
    {{template "chat/page" .}}
    {{template "security/tool-guard" .}}
    ...
</div>

<!-- body 级弹窗：仍按原顺序 -->
{{template "mcp/detail-modal" .}}
{{template "chat/attack-chain-modal" .}}
```

拆分边界按 HTML 结构解析（41 个 content-area 顶层块 + 33 个 body 级弹窗，共 74 个块），
逐块比对原文、校验 include 覆盖后，确认拆分**无损**：页面结构、弹窗归属、脚本加载顺序全部保持原语义。

### 4.2 模板加载（Go）

`server.port` 不变，但模板不再用 `LoadHTMLGlob("web/templates/*")`，改为递归加载所有模块：

```go
// loadWebTemplates 递归加载 web/<module>/templates 下的全部模板文件。
// 模板之间通过 {{template "<module>/<part>" .}} 组合，入口模板为 index.html 与 api-docs.html。
func loadWebTemplates(webRoot string, funcMap template.FuncMap) (*template.Template, error) {
	var files []string
	err := filepath.WalkDir(webRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "static" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".html" || filepath.Base(filepath.Dir(path)) != "templates" {
			return nil
		}
		files = append(files, path)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("扫描前端模板失败: %w", err)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("未找到前端模板: %s", webRoot)
	}
	sort.Strings(files)
	tmpl, err := template.New("").Funcs(funcMap).ParseFiles(files...)
	if err != nil {
		return nil, fmt.Errorf("解析前端模板失败: %w", err)
	}
	return tmpl, nil
}
```

约束：`template.ParseFiles` 以**文件名**作为模板名，因此片段文件名全局唯一（`<module>_<part>.html`），
`define` 名称也全局唯一（`<module>/<part>`）；`index.html`、`api-docs.html` 仍作为页面入口名被 `c.HTML` 使用。

---

## 五、静态资源路由

### 5.1 URL 规则

资源改为模块作用域：`/static/<module>/<js|css|...>/<file>`。

| 改造前 | 改造后 |
|--------|--------|
| `/static/js/router.js` | `/static/core/js/router.js` |
| `/static/js/chat.js` | `/static/chat/js/chat.js` |
| `/static/js/monitor.js` | `/static/mcp/js/monitor.js` |
| `/static/css/style.css` | `/static/core/css/style.css` |
| `/static/css/c2.css` | `/static/c2/css/c2.css` |
| `/static/vendor/*` | `/static/core/vendor/*` |
| `/static/i18n/*.json` | `/static/core/i18n/*.json` |
| `/static/logo.png`、`/static/favicon.ico`、`/static/site.webmanifest` | `/static/core/...` |

引用位置已同步：`core/templates/index.html`（head 样式、脚本标签、懒加载 vendor 列表）、
各模块模板中的内联资源、`core/static/js/i18n.js`（`RESOURCES_PREFIX`）、
`core/static/js/mobile-ui.js`（logo）、`core/static/site.webmanifest`（icon src）。

### 5.2 挂载方式（Go）

模块以 `web/` 下的目录为唯一依据，新增模块目录无需再维护清单：

```go
// registerWebAssets 按模块挂载静态资源（/static/<module>/...），并加载全部模块模板。
func registerWebAssets(router *gin.Engine, webRoot string) error {
	entries, err := os.ReadDir(webRoot)
	if err != nil {
		return fmt.Errorf("扫描前端模块目录失败: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		staticDir := filepath.Join(webRoot, entry.Name(), "static")
		info, err := os.Stat(staticDir)
		if err != nil || !info.IsDir() {
			continue
		}
		router.Static("/static/"+entry.Name(), staticDir)
	}

	templates, err := loadWebTemplates(webRoot, router.FuncMap)
	if err != nil {
		return err
	}
	router.SetHTMLTemplate(templates)
	return nil
}
```

接入点：`setupRoutes` 末尾调用 `registerWebAssets(router, "web")`；`setupRoutes` 改为返回 `error`，
模板/静态初始化失败时由 `app.New` 直接返回错误，避免带病启动。

---

## 六、文件迁移说明

- 静态资源全部通过 `git mv` 迁移，保留文件历史；约 110 个文件以重命名方式落位。
- 原 `web/templates/index.html` 内容拆入 20 个模块的模板片段后删除，壳层重建为 `web/core/templates/index.html`。
- 原 `web/templates/api-docs.html` 迁移为 `web/api-docs/templates/api-docs.html`，模板名与路由不变。
- 测试文件与所测脚本同模块存放（如 `web/mcp/static/js/monitor-blocked-stats.test.cjs`），
  跨模块只读取源码文本，不做运行时依赖。

---

## 七、测试与工具链改动

### 7.1 模板读取工具

大量回归测试原先直接读取 `web/templates/index.html` 做标记断言。新增
`web/core/static/js/test-utils.cjs`，按壳层 include 顺序展开全部片段，结果与浏览器实际 DOM 顺序一致：

```js
// readAllTemplates 按壳层 include 顺序展开所有片段，结果与浏览器实际 DOM 顺序一致。
function readAllTemplates() {
  const partials = readTemplatePartials();
  const shell = fs.readFileSync(path.join(WEB_ROOT, 'core', 'templates', 'index.html'), 'utf8');
  return shell.replace(/\{\{template "([^"]+)" \.\}\}/g, (match, name) =>
    partials.has(name) ? partials.get(name) : match
  );
}
```

测试里统一替换为：

```js
const { readAllTemplates } = require('../../../core/static/js/test-utils.cjs');
const html = readAllTemplates();
```

### 7.2 路径与断言同步

- 45 个 `.test.cjs` 的源码读取路径改为模块路径（`web/<module>/static/js/*.js`）。
- 资源断言改为新 URL，例如 `/static/chat/js/chat-scroll.js?v=...`、`/static/mcp/js/monitor.js?v=...`、
  `/static/settings/js/update.js?v={{.Version}}`、`/static/core/js/auth.js?v=...`。
- `scripts/project-mobile-layout.test.cjs` 改用 `web/projects/templates/projects_page.html`
  与 `web/core/static/css/{style,mobile}.css`。
- CI（`.github/workflows/self-update.yml`）：触发路径改为 `web/*/static/js/**`、`web/core/static/css/style.css`、
  `web/core/templates/index.html`；前端测试命令改为 `node --test web/*/static/js/*.test.cjs`。
- `internal/update/update_test.go` 中受保护路径样例同步为 `web/core/static/js/plugins.js`。

### 7.3 新增/强化测试

| 测试 | 作用 |
|------|------|
| `internal/app/template_render_test.go` | 通过 `loadWebTemplates` 加载全部模块模板，断言 `index.html` 含各页面/弹窗片段、版本号渲染、无残留 `{{template` |
| `internal/app/web_assets_test.go` | 校验各模块的 `/static/<module>/...` 资源均返回 200，首页 HTML 含新资源路径且不含旧 `/static/js/` |

---

## 八、验证结果

```bash
go build ./...
go test ./internal/app/... ./internal/update/...
node --test web/*/static/js/*.test.cjs
```

| 项 | 结果 |
|----|------|
| `go build ./...` | 通过 |
| `go test ./internal/app/... ./internal/update/...` | 通过（模板渲染、模块静态路由、API 文档页均 PASS） |
| 前端测试（45 个文件） | 与改造前基线对比**无新增失败**；剩余 6 项在改造前即失败（见「遗留问题」） |
| 拆分等价性 | 74 个顶层块逐块与原文比对一致，include 覆盖完整，壳层无残留页面块 |
| 旧路径残留 | 仓库内代码/模板/脚本/文档已无 `web/static`、`web/templates` 及 `/static/js/` 引用 |

---

## 九、日常开发约定

1. **新增页面（已有模块）**
   - 在 `web/<module>/templates/` 新建 `<module>_<part>.html`，内容用 `{{define "<module>/<part>"}}` 包裹。
   - 在 `web/core/templates/index.html` 的对应位置加 `{{template "<module>/<part>" .}}`。
   - 脚本/样式放同模块 `static/js`、`static/css`，并在壳层脚本区按现有顺序引入。
2. **新增模块**
   - 直接建 `web/<module>/{templates,static}`：静态资源按 `/static/<module>/` 自动挂载，模板随目录自动加载，无需改 Go 代码。
3. **国际化**
   - 文案键仍集中在 `web/core/static/i18n/*.json`；片段中继续使用 `data-i18n`。
4. **测试**
   - 测试与被测脚本同目录；需要整体标记结构时用 `readAllTemplates()`，不要直接读 `index.html` 断言页面正文。
   - 新增资源引用后，建议同时更新 `web_assets_test.go` 的路径列表与断言。

---

## 十、遗留问题与后续建议

| 项 | 说明 | 建议 |
|----|------|------|
| `settings_page.html` 仍较大 | 系统设置包含 Token、审计、存储、终端、机器人、一键更新等多个分区，当前仍在同一片段（约 171 KB） | 后续可按 `settings-section-*` 继续拆成 `settings_token.html`、`settings_audit.html` 等，壳层按分区 include |
| 既有测试失败（与本次无关） | `c2-listener-form`（4 项）、`knowledge-index-error`（文件级）、`update-ui` 日期格式断言（依赖系统 locale）在改造前基线同样失败 | 单独修复：c2/knowledge 依赖源码切片标记，易随实现漂移；日期断言应固定 locale |
| 脚本标签仍集中在 core 壳层 | 为保证加载顺序不变，模块脚本仍在 `core/templates/index.html` 尾部统一引入 | 若后续引入按需加载，可改为模块自带 `{{define "<module>/scripts"}}` 并在壳层按序 include |
| `test-utils.cjs` 位于 static | 与既有 `.test.cjs` 一样随静态目录发布 | 如需避免对外暴露测试文件，可改为构建期过滤或迁移到 `scripts/` 并调整相对路径 |
| Windows + `core.autocrlf=true` | 工作区为 CRLF 时 `gofmt -l` 会把所有 Go 文件判为未格式化 | 属环境既有现象，提交前按需 `git config core.autocrlf false` 或忽略 |

---

## 十一、相关文档

- [架构说明](architecture.md)
- [开发者指南](developer-guide.md)
- [前端国际化方案](frontend-i18n.md)
- [测试指南](testing.md)
- [部署指南](deployment.md)
