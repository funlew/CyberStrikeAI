# 知识库索引 404 报错修复执行方案

本文针对知识库索引导入失败这条报错，给出根因分析、可执行的三套修复方案、验证步骤与回滚办法。

报错原文：

```
索引写入失败 (知识项：d462b2df-5c15-454d-af17-b4b000c6273e)：[NodeRunError] sqlite indexer:
embed batch 0-10: error, status code: 404, status: 404 Not Found,
message: unexpected end of JSON input, body:
------------------------ node path: [node_3]
```

---

## 一、结论速览

| 项 | 结论 |
|----|------|
| 是否代码缺陷 | **否**，是 `config.yaml` 的向量化（embedding）配置指向了不提供该接口的服务 |
| 直接原因 | `knowledge.embedding.base_url = https://api.deepseek.com`、`model = deepseek-flash`；DeepSeek 只有 Chat Completions，**没有 `/embeddings` 接口** |
| 报错文本为何是 JSON 解析错误 | 404 响应体为空，Eino 的 OpenAI Embedder 对空 body 做 `json.Unmarshal`，于是抛出 `unexpected end of JSON input`，覆盖了真正的 404 语义 |
| 修复动作 | 把 embedding 换成真正支持 embeddings 的服务（推荐阿里云百炼 DashScope `text-embedding-v3`），然后**全量重建索引** |
| 若暂时没有可用 Key | 走「方案 C」：新增启动开关 + 可行动的错误文案，先消除报错与重试风暴，待 Key 就绪再切到方案 A |

实测证据（本机执行，`api_key` 取自当前 `config.yaml`）：

```text
POST https://api.deepseek.com/embeddings  →  404 Not Found（响应体为空）
```

---

## 二、根因链路

```mermaid
graph TD
    A[config.yaml knowledge.embedding] --> B[internal/knowledge/embedder.go NewEmbedder]
    B --> C[Eino OpenAI Embedder 向 base_url + /embeddings 发请求]
    C --> D[DeepSeek 无该接口，返回 404 且 body 为空]
    D --> E[SDK 解析空 JSON: unexpected end of JSON input]
    E --> F[indexer.go 包装为「索引写入失败 (知识项：xxx)」]
    F --> G[启动日志 / 前端索引进度区提示]
```

关键代码位置（行号仅供参考）：

| 位置 | 作用 |
|------|------|
| `config.yaml` `knowledge.embedding`（约 527-530 行） | `provider/model/base_url/api_key`，当前指向 DeepSeek |
| [embedder.go](file:///d:/liufan/BaiduSyncdisk/00-ctc-github-workspace/CyberStrikeAI/internal/knowledge/embedder.go) `NewEmbedder` | 组装 base_url、model、api_key；**`provider` 字段未参与分支判断，一律按 OpenAI 兼容协议调用** |
| [embedder.go](file:///d:/liufan/BaiduSyncdisk/00-ctc-github-workspace/CyberStrikeAI/internal/knowledge/embedder.go) `EmbedStrings` | 重试与限流；404/401 不在可重试列表，直接返回错误 |
| [indexer.go](file:///d:/liufan/BaiduSyncdisk/00-ctc-github-workspace/CyberStrikeAI/internal/knowledge/indexer.go) 约 186-192 行 | 拼出「索引写入失败 (知识项：…)」并记录 `lastError` |
| [app.go](file:///d:/liufan/BaiduSyncdisk/00-ctc-github-workspace/CyberStrikeAI/internal/app/app.go) 约 347-352 行 | 冷启动「未检测到索引 → 自动构建」，是复现报错的最常见入口 |
| [app.go](file:///d:/liufan/BaiduSyncdisk/00-ctc-github-workspace/CyberStrikeAI/internal/app/app.go) 约 2328 行 | 配置热重载后同样会自动补索引 |

补充说明：

- 之前出现过的 `401 Unauthorized ... help.aliyun.com` 是另一份配置（DashScope 占位 Key `sk-xxxxxxx`）导致的鉴权失败，与本次 404 是同一类问题的不同表现。
- `knowledge.retrieval.rerank` 的 `base_url`/`api_key` 留空时会**回退到 embedding 的配置**，因此 embedding 换服务后，精排会同步换成该服务，需要同一个 Key 具备 `gte-rerank` 权限（或显式单独配置）。

---

## 三、方案对比

| 方案 | 服务 | 配置要点 | 需要 Key | 国内直连 | 备注 |
|------|------|----------|----------|----------|------|
| **A（推荐）** | 阿里云百炼 DashScope | `compatible-mode/v1` + `text-embedding-v3`（1024 维） | 百炼 API Key | 是 | 精排 `gte-rerank` 可复用同一 Key，改动最小 |
| B1 | OpenAI | `api.openai.com/v1` + `text-embedding-3-small`（1536 维） | OpenAI Key | 需代理 | 维度更高，成本略高 |
| B2 | 硅基流动 SiliconFlow | `api.siliconflow.cn/v1` + `BAAI/bge-m3`（1024 维） | SiliconFlow Key | 是 | 国内可用，按量计费 |
| B3 | 自建/本地（Ollama、Xinference、vLLM） | 任意 OpenAI 兼容 `/v1/embeddings` | 通常不需要 | 内网可用 | 需自行部署模型，首次拉模型较大 |
| **C** | 暂不接入 | 关闭启动自动索引 + 改进错误提示 | 不需要 | — | 只消除报错，检索仍不可用 |

> 注意：`knowledge.embedding.provider` 当前只用于语义描述与日志，代码固定走 OpenAI 兼容协议。因此接 DashScope / SiliconFlow 时填 `provider: openai` 即可，真正生效的是 `base_url` 与 `model`。

---

## 四、方案 A（推荐）：切换到阿里云百炼 DashScope

### A1. 前置准备

1. 登录阿里云百炼控制台，开通服务并创建 API-KEY（`sk-` 开头）。
2. 确认该 Key 具备 `text-embedding-v3`（向量化）与 `gte-rerank`（精排）权限。
3. 备份当前配置：

```powershell
Copy-Item config.yaml config.yaml.bak-embedding -Force
```

### A2. 修改 `config.yaml`

```yaml
knowledge:
  enabled: true
  embedding:
    provider: openai                              # 走 OpenAI 兼容协议，保持不变
    model: text-embedding-v3                      # 替换 deepseek-flash
    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1   # 替换 https://api.deepseek.com
    api_key: sk-你的百炼Key                        # 替换旧 Key

  retrieval:
    rerank:
      provider: dashscope        # 显式指定，避免依赖 base_url 推断
      model: gte-rerank
      base_url: ""               # 留空 → 复用 embedding 的 base_url
      api_key: ""                # 留空 → 复用 embedding 的 api_key
```

要点：

- 不要把 `base_url` 写成 `https://dashscope.aliyuncs.com`，必须是**兼容模式**的 `/compatible-mode/v1`，否则又会得到 404。
- 主对话模型（`ai.model = deepseek-flash`）无需改动，知识库向量化与对话模型可以分开。
- `config.yaml` 已被 `.gitignore` 忽略，Key 不会进入仓库。

### A3. 重启前先做连通性探针

PowerShell：

```powershell
$key  = 'sk-你的百炼Key'
$body = '{"input":["ping"],"model":"text-embedding-v3"}'
$r = Invoke-WebRequest -Uri 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings' `
  -Method POST `
  -Headers @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' } `
  -Body $body -UseBasicParsing
"status=$($r.StatusCode)"
(($r.Content | ConvertFrom-Json).data[0].embedding).Count    # 期望 1024
```

curl：

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"input":["ping"],"model":"text-embedding-v3"}'
```

判定标准：`status=200` 且向量维度为 1024。若仍为 401/404，先解决 Key 或地址问题，不要进入下一步。

### A4. 重新编译并重启服务

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess -Force
go build -o cyberstrike-ai.exe ./cmd/server
.\cyberstrike-ai.exe -config config.yaml --http
```

启动日志中应不再出现 `索引知识项失败` / `索引写入失败`；出现 `增量索引完成` 或 `自动构建知识库索引` 完成后即为正常。

### A5. 全量重建索引（必须）

切换到新模型后向量维度与语义空间都变了，**必须重建**，不能增量续写。

- 页面操作：知识库页面 → 索引进度区 → **全量重建**（`web/knowledge/static/js/knowledge.js` 中的 `rebuildKnowledgeIndexFull()`）。
- 接口方式（需登录态 Bearer Token）：

```bash
POST /api/knowledge/index?mode=full     # 全量重建
GET  /api/knowledge/index-status        # 查询进度：rebuild_total / rebuild_current / rebuild_failed
POST /api/knowledge/index               # 增量补齐（日常使用）
```

- 服务端实现：`internal/handler/knowledge.go` 中 `mode=full` → `indexer.RunRebuildIndex`，控制函数 `rebuildKnowledgeIndexFull()`。

### A6. 验收标准

| 检查项 | 期望结果 |
|--------|----------|
| 启动日志 | 无 `status code: 404` / `unexpected end of JSON input` |
| `/api/knowledge/index-status` | `rebuild_failed = 0`，`rebuild_current = rebuild_total` |
| 页面索引进度 | 显示完成，无失败项 |
| 语义检索 | 知识库检索日志（`/api/knowledge/retrieval-logs`）出现命中记录，且分数高于 `similarity_threshold`（默认 0.4） |
| 精排 | 日志不再出现 dashscope 401，精排 provider 为 `dashscope` / `gte-rerank` |

---

## 五、方案 B：其它 OpenAI 兼容服务

只改 `knowledge.embedding` 与（可选）`retrieval.rerank`，其余步骤同 A3-A6。

### B1. OpenAI

```yaml
knowledge:
  embedding:
    provider: openai
    model: text-embedding-3-small      # 1536 维
    base_url: https://api.openai.com/v1 # 走代理时换成代理的 /v1 地址
    api_key: sk-你的 OpenAI Key
```

### B2. 硅基流动 SiliconFlow

```yaml
knowledge:
  embedding:
    provider: openai
    model: BAAI/bge-m3                 # 1024 维
    base_url: https://api.siliconflow.cn/v1
    api_key: sk-你的 SiliconFlow Key
```

### B3. 内网自建（Ollama 示例）

```yaml
knowledge:
  embedding:
    provider: openai
    model: nomic-embed-text
    base_url: http://127.0.0.1:11434/v1
    api_key: ollama                    # 占位即可，服务端不校验
```

自建服务需确认支持 `POST /v1/embeddings`（Ollama ≥ 0.3、Xinference、vLLM 的 OpenAI 兼容层均支持）。

---

## 六、方案 C：暂不接入，先消除报错

适用：暂时拿不到 Key，或希望内网部署前先让平台安静运行。检索功能会不可用，但不再产生 404 报错与失败重试。

### C1. 新增 `auto_build_on_startup` 开关（默认 true，保持现有行为）

1. `internal/config/config.go` → `IndexingConfig` 增加字段：

```go
// AutoBuildOnStartup 冷启动与配置热重载后是否自动补齐缺失索引；默认 true
AutoBuildOnStartup *bool `yaml:"auto_build_on_startup,omitempty" json:"auto_build_on_startup,omitempty"`
```

2. `internal/app/app.go` 两处自动索引（初始化约 347-352 行、热重载约 2328 行）前加判断：

```go
if cfg.Knowledge.Indexing.AutoBuildOnStartup == nil || *cfg.Knowledge.Indexing.AutoBuildOnStartup {
    // 原自动索引逻辑
}
```

3. `config.example.yaml` 与 `config.yaml` 补注释说明。

4. 关闭方式：

```yaml
knowledge:
  indexing:
    auto_build_on_startup: false
```

### C2. 把错误文案改成可行动提示

在 `internal/knowledge/embedder.go` 的 `EmbedStrings` 返回错误处附加上下文（函数内可复用 `NewEmbedder` 的取值逻辑）：

```go
func (e *Embedder) describeTarget() string {
    base := strings.TrimSuffix(strings.TrimSpace(e.config.Embedding.BaseURL), "/")
    if base == "" {
        base = "https://api.openai.com/v1"
    }
    model := strings.TrimSpace(e.config.Embedding.Model)
    if model == "" {
        model = "text-embedding-3-small"
    }
    return fmt.Sprintf("base_url=%s, model=%s", base, model)
}

// 404/401 时追加排查建议
if strings.Contains(errStr, "404") {
    hint = "；该 base_url 可能不提供 /embeddings 接口（例如 DeepSeek 只有 Chat Completions），请改用支持向量化的服务"
} else if strings.Contains(errStr, "401") {
    hint = "；API Key 无效或无权访问该模型"
}
return nil, fmt.Errorf("嵌入请求失败（%s）: %w%s", e.describeTarget(), lastErr, hint)
```

改造后，同样的配置问题会直接提示「base_url … 不提供 /embeddings 接口」，而不是 `unexpected end of JSON input`。

### C3.（可选）冷启动预检

在自动索引前做一次单条探针，失败则跳过并只记一条 WARN，避免连续失败刷屏：

```go
if _, probeErr := embedder.EmbedText(context.Background(), "ping"); probeErr != nil {
    log.Logger.Warn("跳过知识库自动索引：嵌入服务不可用，请检查 knowledge.embedding",
        zap.String("hint", "base_url / model / api_key"), zap.Error(probeErr))
} else if err := knowledgeIndexer.IndexMissing(ctx); err != nil {
    log.Logger.Warn("自动构建知识库索引失败", zap.Error(err))
}
```

### C4. 前端提示（可选）

`web/core/static/i18n/{zh-CN,en-US,ru-RU}.json` 增加
`knowledge.index.embeddingUnavailable`，在索引进度区展示该提示，替代原始 SDK 错误。

---

## 七、执行 Checklist

方案 A（推荐）：

- [ ] 备份 `config.yaml`
- [ ] 百炼创建 API-KEY，确认 `text-embedding-v3` / `gte-rerank` 权限
- [ ] 修改 `knowledge.embedding`（model / base_url / api_key）与 `retrieval.rerank`
- [ ] 跑 A3 探针，确认 200 且维度 1024
- [ ] 停止旧进程 → `go build -o cyberstrike-ai.exe ./cmd/server` → `--http` 启动
- [ ] 确认启动日志无 401/404 索引错误
- [ ] 执行「全量重建」（页面按钮或 `POST /api/knowledge/index?mode=full`）
- [ ] `GET /api/knowledge/index-status` 确认 `rebuild_failed = 0`
- [ ] 语义检索冒烟：`POST /api/knowledge/search` 返回命中结果

方案 C：

- [ ] 按 C1 增加开关并在 `config.yaml` 置 `false`
- [ ] 按 C2 改造错误文案（可选 C3/C4）
- [ ] `go build ./...` + 重启，确认启动日志不再出现索引失败
- [ ] 记录待办：Key 就绪后切回方案 A 并全量重建

---

## 八、回滚

| 场景 | 操作 |
|------|------|
| 新配置不可用 | 恢复 `config.yaml.bak-embedding` 后重启；或 `git checkout -- config.yaml`（若该文件在版本库中） |
| 新模型索引异常 | 保留配置，重新执行「全量重建」；必要时清空 `data/knowledge.db` 中的向量表后重建 |
| 代码改动（方案 C）需回退 | 回滚 `internal/config/config.go` 与 `internal/app/app.go` 的对应提交 |

回滚只影响知识库向量化，不影响对话、工具、C2 等其它模块。

---

## 九、风险与注意事项

1. **换模型必须全量重建**：`text-embedding-v3` / `bge-m3` 为 1024 维，`text-embedding-3-small` 为 1536 维；维度或语义空间不一致会导致相似度失真甚至写入失败。
2. **当前失败的索引可能残留半成品数据**：重建前确认 `index-status` 无进行中的任务；如有，先等待或重启服务再重建。
3. **精排联动**：`rerank.api_key` / `base_url` 留空会复用 embedding 配置；若把 embedding 指向某个只提供嵌入的代理，需显式填写 rerank 的地址与 Key。
4. **Key 安全**：`config.yaml`、`config.yaml.backup` 已在 `.gitignore` 中，仍应避免把带 Key 的配置贴到 issue/日志；`config.example.yaml` 只放占位符。
5. **限流与计费**：DashScope 有免费额度与 QPS 限制；知识项较多时可调低 `indexing.max_rpm` 或增大 `rate_limit_delay_ms`（当前为 300ms）。
6. **离线/内网**：优先自建 OpenAI 兼容嵌入服务，把 `base_url` 指向内网地址；不要依赖公网 Key。
7. **`provider` 字段不参与路由**：填 `openai` 只是语义约定，真正的服务由 `base_url` 决定，切换服务时务必同步改 `base_url`。
