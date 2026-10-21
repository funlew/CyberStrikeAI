# CyberStrikeAI 本地运行指南（Windows / macOS）

> 本文档汇总两个主流开发平台的本地启动条件，命令均经过源码与 `run.sh` 校验。Linux 平台仅文档末尾附差异提示。

---

## 通用前置条件

| 依赖 | 版本要求 | 用途 | 来源 |
|------|----------|------|------|
| Go | **1.25+**（以 `go.mod` 为准） | 编译主服务二进制 | `go.mod` 第 5 行 |
| Python | **3.10+** | 部分 MCP 工具（`http-framework-test`、`api-fuzzer` 等）的运行环境 | `run.sh: check_python()` |
| C 编译器（CGO） | 平台原生 | SQLite 驱动 `mattn/go-sqlite3` | `go.mod` |
| Git | 任意新版 | 一键更新、依赖拉取 | `internal/update/` |

**首次启动必配置项**（否则 Web 可访问但功能不完整）：

| 配置 | 说明 |
|------|------|
| `ai.channels.<id>.api_key / base_url / model` | 至少一个 OpenAI 兼容通道（OpenAI / DeepSeek / Qwen / Claude 等）|
| `knowledge.embedding.api_key` | 启用 RAG 知识库时必填 |
| `robots.*` | 接入企微 / 钉钉 / 飞书 / Slack / Discord / Telegram / QQ 时填 |
| `fofa / zoomeye / quake / shodan` | 网络空间测绘查询时填 |

> `config.yaml` 不存在时，进程会自动从 `config.example.yaml` 复制一份并打印提示。

---

## Windows 平台

### 1. 必备工具链

| 项 | 推荐方案 |
|----|----------|
| Go | `winget install GoLang.Go` 或官网下载 msi |
| Python | 官网安装包，勾选 Add to PATH；或 `winget install Python.Python.3.12` |
| **C 编译器**（最关键） | 任选其一：<br>• [w64devkit](https://github.com/skeeto/w64devkit)（解压即用）<br>• [MSYS2](https://www.msys2.org/) → `pacman -S mingw-w64-x86_64-gcc`<br>• TDM-GCC |

C 编译器装完后将 `bin` 目录加入系统 PATH，新开 PowerShell 校验：

```powershell
gcc --version
go env CGO_ENABLED   # 应输出 1
```

> ⚠️ 没有 gcc 时 `go build` 会报 `cgo: C compiler "gcc" not found`，无法编译。

### 2. 不能直接运行 `run.sh`

`run.sh` 是 Bash 脚本，依赖 `mktemp`、`source`、`set -euo pipefail` 等 Unix 特性，Windows PowerShell 不兼容。**Windows 必须手动用 Go 命令构建**。

### 3. 推荐启动流程（PowerShell）

```powershell
# 进入项目根目录
cd d:\path\to\CyberStrikeAI

# （可选）大陆网络加速
go env -w GOPROXY=https://goproxy.cn,direct

# 拉依赖
go mod download

# 编译
go build -o cyberstrike-ai.exe .\cmd\server

# 启动（HTTPS，本机自签证书）
.\cyberstrike-ai.exe -config config.yaml --https

# 或纯 HTTP
.\cyberstrike-ai.exe -config config.yaml --http
```

启动成功后：
- 浏览器访问 `https://127.0.0.1:8080/`，首次信任一次自签证书
- 终端 `ADMIN SETUP REQUIRED` 段落打印一次性 `admin` 初始密码，登录后立刻修改

### 4. Python 虚拟环境（按需）

Windows 上 `run.sh` 不可用，需手动建：

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

只有当 Agent 调用 `execute-python-script`、`http-framework-test` 这类需要 Python 的工具时才必须；纯对话场景可跳过。

### 5. 渗透工具（可选）

通过 [Scoop](https://scoop.sh/) 或 [Chocolatey](https://community.chocolatey.org/) 安装：

```powershell
scoop bucket add main
scoop install nmap masscan sqlmap nuclei ffuf subfinder
```

不装不影响启动；只在 Agent 实际调用对应工具时才需要。

### 6. Windows 特有注意点

| 现象 | 处理 |
|------|------|
| `8080` / `8081` 端口冲突 | 修改 `config.yaml` `server.port` / `mcp.port` |
|  Defender 防火墙弹窗 | 允许 `cyberstrike-ai.exe` 接受入站连接（本机访问也可点取消） |
| 中文输出乱码 | `chcp 65001` 切到 UTF-8 代码页 |
| 进程隔离 | 自动启用 Job Object（`platform_windows.go`），无需配置 |

---

## macOS 平台

### 1. 必备工具链（三步搞定）

```bash
# ① Xcode Command Line Tools（自带 clang / make / git，解决 CGO）
xcode-select --install

# ② Go 1.25+
brew install go

# ③ Python 3.10+（macOS 自带 3.9，建议升级）
brew install python@3.12
```

校验：

```bash
go version       # 应 ≥ go1.25
python3 --version
clang --version  # 随 CLT 自带
```

> macOS **无需额外安装 gcc**，`mattn/go-sqlite3` 直接用 CLT 的 clang 编译。

### 2. 一键启动（推荐路径）

```bash
git clone https://github.com/AIPentest/CyberStrikeAI.git
cd CyberStrikeAI
chmod +x run.sh && ./run.sh        # 默认 HTTPS
# 或：./run.sh --http              # 纯 HTTP
```

`run.sh` 自动完成：
- ✅ 校验 `python3` 与 `go` 版本
- ✅ 创建 `venv/` 并用清华镜像 `pip install -r requirements.txt`
- ✅ 用 `goproxy.cn` 执行 `go mod download`
- ✅ `go build -o cyberstrike-ai ./cmd/server`
- ✅ 启动服务（自动 `-config config.yaml`，无需关心 cwd）

启动后浏览器访问 `https://127.0.0.1:8080/`，信任自签证书即可。

### 3. 手动构建（不想用 run.sh）

```bash
go env -w GOPROXY=https://goproxy.cn,direct    # 大陆加速（可选）
go mod download
go build -o cyberstrike-ai ./cmd/server
./cyberstrike-ai -config config.yaml --https
```

### 4. 渗透工具（可选，一行 brew）

```bash
brew install nmap masscan sqlmap nikto gobuster ffuf hydra hashcat nuclei subfinder
```

### 5. macOS 特有注意点

| 现象 | 处理 |
|------|------|
| Gatekeeper 拦截自编译二进制 | `xattr -d com.apple.quarantine ./cyberstrike-ai` |
| Apple Silicon (M1/M2/M3) | Go 与 `go-sqlite3` 原生支持 `darwin/arm64`，无需交叉编译 |
| 系统 bash 仅 3.2 | `run.sh` 已兼容；如要稳妥：`brew install bash` 后用 `/opt/homebrew/bin/bash run.sh` |
| 防火墙弹窗 | 首次启动允许 `cyberstrike-ai` 接收连接即可 |
| 进程隔离 | 走 Unix watchdog 模式（`platform_other.go` + `group_unix.go`），`security.process_isolation.mode` 必须保持 `auto`，**不能设 `required` 或填 `cgroup_root`**（macOS 无 cgroup） |

---

## Linux 平台简要提示

Linux 是 `run.sh` 的"主场"，与 macOS 几乎一致，多一项可选：

```bash
sudo apt install -y build-essential python3 python3-venv python3-pip
# Go 与 Python 版本要求同 Windows/macOS
```

**Linux 独有能力**：生产部署可启用 cgroup v2 真·内核级隔离：

```yaml
security:
  process_isolation:
    mode: required          # 或 auto
    cgroup_root: auto       # 配合 systemd Delegate=cpu memory pids
```

需要 systemd service 配置 `Delegate=cpu memory pids`，详见 `docs/zh-CN/deployment.md`。

---

## 跨平台通用问题

### 启动参数速查

| 命令 | 作用 |
|------|------|
| `cyberstrike-ai -config config.yaml --https` | HTTPS 启动（无证书时内存自签） |
| `cyberstrike-ai -config config.yaml --http` | 强制明文 HTTP |
| `cyberstrike-ai --reset-admin-password` | 终端交互式重置 admin 密码 |
| `cyberstrike-ai --check-process-isolation` | 探测进程隔离后端是否就绪 |
| `cyberstrike-ai -check-update` | 检查更新源是否有新版本 |
| `cyberstrike-ai -update` | 快进 + 重编译 + 原子换二进制 |
| `cyberstrike-ai -update-rollback` | 撤销上一次 `-update` |

环境变量 `CYBERSTRIKE_HTTPS=1` 等价于 `--https`，便于 systemd / Docker 不传参场景。

### 首次启动检查清单

按顺序确认即可：

1. `go env CGO_ENABLED` 输出 `1`
2. `gcc --version`（Windows）或 `clang --version`（macOS）能正常返回
3. `config.yaml` 中至少一个 AI 通道填了 `api_key`
4. 启动后终端有 `● ONLINE` 字样与实际监听 URL
5. 浏览器访问该 URL 看到登录页
6. 用一次性 admin 密码登录后立刻改密码并配置 RBAC

### 数据持久化路径

所有运行期写入数据都在以下目录，**升级与回滚均保留**：

| 路径 | 内容 |
|------|------|
| `data/conversations.db` | 对话 / 用户 / 工具执行记录 / HITL / 审计日志 / C2 |
| `data/knowledge.db` | 知识库向量（如启用独立 DB） |
| `tmp/workspace/` | Agent 工作区（curl/wget 下载、文件读取分析） |
| `tmp/reduction/` | 超长工具输出落盘 |
| `tmp/c2/` | C2 截图、payload、上传件 |
| `log/` | 诊断日志（warn 及以上，按日期切分） |

可通过 `config.yaml` `storage.*` 配置自动清理策略。

---

## 一句话总结

- **Windows**：必须先装 **gcc 工具链**（w64devkit / MSYS2），然后 `go build` 启动；不能跑 `run.sh`。
- **macOS**：`xcode-select --install` + `brew install go`，然后 **`./run.sh` 一键搞定**。
- **Linux**：与 macOS 一致，多一个生产级 cgroup 隔离选项。
