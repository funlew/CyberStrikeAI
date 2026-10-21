package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/mcp"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// toolNamePattern 工具名安全校验：防止路径穿越，仅允许字母数字与 _ . -
var toolNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)

// maxToolYAMLBytes 单个工具配置文件大小上限（1MB）
const maxToolYAMLBytes = 1 << 20

// ToolStatEntry 单个工具的调用统计
type ToolStatEntry struct {
	Name         string     `json:"name"`
	Enabled      bool       `json:"enabled"`
	Source       string     `json:"source"` // dir（目录文件）或 inline（config.yaml 内联）
	HasFile      bool       `json:"has_file"`
	Calls        int        `json:"calls"`
	Success      int        `json:"success"`
	Failed       int        `json:"failed"`
	Blocked      int        `json:"blocked"`
	LastCallTime *time.Time `json:"last_call_time,omitempty"`
}

// ToolStatsResponse 工具状态统计响应
type ToolStatsResponse struct {
	Total        int             `json:"total"`
	Enabled      int             `json:"enabled"`
	Disabled     int             `json:"disabled"`
	DirTools     int             `json:"dir_tools"`
	InlineTools  int             `json:"inline_tools"`
	TotalCalls   int             `json:"total_calls"`
	SuccessCalls int             `json:"success_calls"`
	FailedCalls  int             `json:"failed_calls"`
	BlockedCalls int             `json:"blocked_calls"`
	ToolsDir     string          `json:"tools_dir"`
	Tools        []ToolStatEntry `json:"tools"`
}

// ToolYAMLResponse 单个工具 YAML 详情响应
type ToolYAMLResponse struct {
	Name    string `json:"name"`
	Source  string `json:"source"` // dir 或 inline
	HasFile bool   `json:"has_file"`
	File    string `json:"file,omitempty"`
	Content string `json:"content,omitempty"`
}

// toolsDirAbs 返回工具配置目录的绝对路径。
func (h *ConfigHandler) toolsDirAbs() string {
	dir := config.ResolveToolsDir(h.config.Security.ToolsDir, h.configPath)
	if strings.TrimSpace(dir) == "" {
		dir = filepath.Join(filepath.Dir(h.configPath), "tools")
	}
	return dir
}

// findToolFile 返回工具名对应的已存在文件（.yaml 优先，其次 .yml）；不存在时返回空串。
func (h *ConfigHandler) findToolFile(name string) string {
	dir := h.toolsDirAbs()
	for _, ext := range []string{".yaml", ".yml"} {
		p := filepath.Join(dir, name+ext)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// isInlineTool 判断工具是否仅存在于 config.yaml 的内联列表（无目录文件）。
func (h *ConfigHandler) isInlineTool(name string) bool {
	for _, tool := range h.config.Security.Tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

// reloadToolsAndRegister 从 tools 目录重新加载并重新注册到 MCP。调用方需持有 h.mu 写锁。
func (h *ConfigHandler) reloadToolsAndRegister() error {
	if err := config.ReloadSecurityToolsFromDir(h.config, h.configPath); err != nil {
		return err
	}
	if h.mcpServer != nil {
		h.mcpServer.ClearTools()
		if h.executor != nil {
			h.executor.RegisterTools(h.mcpServer)
		}
	}
	return nil
}

// GetToolsStats 获取工具状态统计：GET /api/config/tool-stats
func (h *ConfigHandler) GetToolsStats(c *gin.Context) {
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate")

	h.mu.RLock()
	tools := append([]config.ToolConfig(nil), h.config.Security.Tools...)
	h.mu.RUnlock()

	var callStats map[string]*mcp.ToolStats
	if h.db != nil {
		if m, err := h.db.LoadToolStats(); err == nil {
			callStats = m
		}
	}

	resp := ToolStatsResponse{
		Total:    len(tools),
		ToolsDir: h.toolsDirAbs(),
		Tools:    make([]ToolStatEntry, 0, len(tools)),
	}
	for _, tool := range tools {
		entry := ToolStatEntry{Name: tool.Name, Enabled: tool.Enabled, Source: "inline"}
		if h.findToolFile(tool.Name) != "" {
			entry.HasFile = true
			entry.Source = "dir"
			resp.DirTools++
		} else {
			resp.InlineTools++
		}
		if tool.Enabled {
			resp.Enabled++
		} else {
			resp.Disabled++
		}
		if stats, ok := callStats[tool.Name]; ok && stats != nil {
			entry.Calls = stats.TotalCalls
			entry.Success = stats.SuccessCalls
			entry.Failed = stats.FailedCalls
			entry.Blocked = stats.BlockedCalls
			entry.LastCallTime = stats.LastCallTime
			resp.TotalCalls += stats.TotalCalls
			resp.SuccessCalls += stats.SuccessCalls
			resp.FailedCalls += stats.FailedCalls
			resp.BlockedCalls += stats.BlockedCalls
		}
		resp.Tools = append(resp.Tools, entry)
	}

	// 调用次数降序，其次按名称排序，便于状态页查看热点工具
	sort.SliceStable(resp.Tools, func(i, j int) bool {
		if resp.Tools[i].Calls != resp.Tools[j].Calls {
			return resp.Tools[i].Calls > resp.Tools[j].Calls
		}
		return resp.Tools[i].Name < resp.Tools[j].Name
	})

	c.JSON(http.StatusOK, resp)
}

// GetToolYAML 读取单个工具的 YAML 原文：GET /api/config/tools/:name
func (h *ConfigHandler) GetToolYAML(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if !toolNamePattern.MatchString(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法的工具名称"})
		return
	}
	file := h.findToolFile(name)
	if file == "" {
		if h.isInlineTool(name) {
			c.JSON(http.StatusOK, ToolYAMLResponse{Name: name, Source: "inline", HasFile: false})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "工具不存在"})
		return
	}
	data, err := os.ReadFile(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取工具配置失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, ToolYAMLResponse{
		Name:    name,
		Source:  "dir",
		HasFile: true,
		File:    file,
		Content: string(data),
	})
}

// CreateToolYAML 新建工具配置文件：POST /api/config/tools
func (h *ConfigHandler) CreateToolYAML(c *gin.Context) {
	var req struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求体解析失败"})
		return
	}
	name := strings.TrimSpace(req.Name)
	content := req.Content
	if !toolNamePattern.MatchString(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法的工具名称（仅允许字母数字与 _ . -）"})
		return
	}
	if strings.TrimSpace(content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工具配置内容不能为空"})
		return
	}
	if len(content) > maxToolYAMLBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工具配置内容过大"})
		return
	}
	if h.findToolFile(name) != "" {
		c.JSON(http.StatusConflict, gin.H{"error": "同名工具已存在"})
		return
	}

	dir := h.toolsDirAbs()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建工具目录失败: " + err.Error()})
		return
	}
	file := filepath.Join(dir, name+".yaml")
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入工具配置失败: " + err.Error()})
		return
	}

	h.mu.Lock()
	err := h.reloadToolsAndRegister()
	h.mu.Unlock()
	if err != nil {
		h.logger.Warn("新建工具后重新加载失败", zap.String("tool", name), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "工具已写入，但重新加载失败: " + err.Error()})
		return
	}
	h.logger.Info("已新建工具", zap.String("tool", name), zap.String("file", file))
	c.JSON(http.StatusOK, gin.H{"message": "工具已创建", "name": name, "file": file})
}

// UpdateToolYAML 保存工具 YAML：PUT /api/config/tools/:name
func (h *ConfigHandler) UpdateToolYAML(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if !toolNamePattern.MatchString(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法的工具名称"})
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求体解析失败"})
		return
	}
	content := req.Content
	if strings.TrimSpace(content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工具配置内容不能为空"})
		return
	}
	if len(content) > maxToolYAMLBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "工具配置内容过大"})
		return
	}
	file := h.findToolFile(name)
	if file == "" {
		if h.isInlineTool(name) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该工具为 config.yaml 内联工具，请在主配置中维护"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "工具不存在"})
		return
	}
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入工具配置失败: " + err.Error()})
		return
	}

	h.mu.Lock()
	err := h.reloadToolsAndRegister()
	h.mu.Unlock()
	if err != nil {
		h.logger.Warn("更新工具后重新加载失败", zap.String("tool", name), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "工具已写入，但重新加载失败: " + err.Error()})
		return
	}
	h.logger.Info("已更新工具", zap.String("tool", name), zap.String("file", file))
	c.JSON(http.StatusOK, gin.H{"message": "工具已保存", "name": name, "file": file})
}

// DeleteToolYAML 删除工具配置文件：DELETE /api/config/tools/:name
func (h *ConfigHandler) DeleteToolYAML(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if !toolNamePattern.MatchString(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "非法的工具名称"})
		return
	}
	file := h.findToolFile(name)
	if file == "" {
		if h.isInlineTool(name) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该工具为 config.yaml 内联工具，无法在此删除"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "工具不存在"})
		return
	}
	if err := os.Remove(file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除工具配置失败: " + err.Error()})
		return
	}

	h.mu.Lock()
	err := h.reloadToolsAndRegister()
	h.mu.Unlock()
	if err != nil {
		h.logger.Warn("删除工具后重新加载失败", zap.String("tool", name), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "工具已删除，但重新加载失败: " + err.Error()})
		return
	}
	h.logger.Info("已删除工具", zap.String("tool", name), zap.String("file", file))
	c.JSON(http.StatusOK, gin.H{"message": "工具已删除", "name": name})
}
