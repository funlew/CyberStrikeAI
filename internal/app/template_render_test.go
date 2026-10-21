package app

import (
	"bytes"
	"html/template"
	"path/filepath"
	"testing"
)

// newWebTemplates 按工程目录加载模块化前端模板，供路由与测试共享同一套解析逻辑。
func newWebTemplates(t *testing.T) *template.Template {
	t.Helper()
	templates, err := loadWebTemplates(filepath.Join("..", "..", "web"), template.FuncMap{})
	if err != nil {
		t.Fatalf("server template initialization fails: %v", err)
	}
	return templates
}

func TestFrontendTemplatesRender(t *testing.T) {
	templates := newWebTemplates(t)
	var output bytes.Buffer
	if err := templates.ExecuteTemplate(&output, "index.html", map[string]interface{}{"Version": "test"}); err != nil {
		t.Fatal(err)
	}
	html := output.String()
	// 每个功能模块的页面片段都应被组合进壳层页面。
	for _, marker := range []string{
		`<div id="page-dashboard"`,
		`<div id="page-chat"`,
		`<div id="page-settings"`,
		`<div id="page-platform-rbac"`,
		`<div id="mcp-detail-modal"`,
		`<div id="chat-files-mkdir-modal"`,
	} {
		if !bytes.Contains(output.Bytes(), []byte(marker)) {
			t.Errorf("index.html 缺少片段: %s", marker)
		}
	}
	if !bytes.Contains(output.Bytes(), []byte(">test<")) {
		t.Error("index.html 未渲染版本号")
	}
	if bytes.Contains(output.Bytes(), []byte(`{{template`)) {
		t.Error("index.html 存在未展开的模板指令")
	}
	if !bytes.Contains([]byte(html), []byte(`id="login-overlay"`)) {
		t.Error("index.html 缺少登录浮层")
	}
}

func TestAPIDocsTemplateRender(t *testing.T) {
	templates := newWebTemplates(t)
	var output bytes.Buffer
	if err := templates.ExecuteTemplate(&output, "api-docs.html", nil); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte("/static/core/js/i18n.js")) {
		t.Error("api-docs.html 未引用 core 模块的 i18n 资源")
	}
}
