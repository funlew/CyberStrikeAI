package app

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestRegisterWebAssetsServesModuleStatic 校验按模块挂载的静态目录与壳层页面引用一致。
func TestRegisterWebAssetsServesModuleStatic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err := registerWebAssets(router, filepath.Join("..", "..", "web")); err != nil {
		t.Fatalf("registerWebAssets: %v", err)
	}
	router.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "index.html", gin.H{"Version": "test"})
	})

	for _, path := range []string{
		"/static/core/css/style.css",
		"/static/core/css/mobile.css",
		"/static/core/js/router.js",
		"/static/core/vendor/marked.min.js",
		"/static/core/i18n/zh-CN.json",
		"/static/core/logo.png",
		"/static/chat/js/chat.js",
		"/static/chat/css/chat-plan-progress.css",
		"/static/security/js/tool-guard.js",
		"/static/c2/css/c2.css",
		"/static/settings/js/update.js",
		"/static/api-docs/js/api-docs.js",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Errorf("%s 应返回 200，实际 %d", path, recorder.Code)
		}
		if recorder.Body.Len() == 0 {
			t.Errorf("%s 返回内容为空", path)
		}
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("/ 应返回 200，实际 %d", recorder.Code)
	}
	body := recorder.Body.String()
	for _, marker := range []string{
		`/static/core/css/style.css`,
		`/static/chat/js/chat.js`,
		`/static/settings/js/update.js?v=test`,
		`<div id="page-dashboard"`,
	} {
		if !strings.Contains(body, marker) {
			t.Errorf("首页 HTML 缺少 %s", marker)
		}
	}
	if strings.Contains(body, `"/static/js/`) || strings.Contains(body, `'/static/js/`) {
		t.Error("首页 HTML 仍引用旧的 /static/js 路径")
	}
}
