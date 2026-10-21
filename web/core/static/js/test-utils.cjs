// 前端回归测试公共工具：把 web/<module>/templates 下的片段按壳层 include 顺序展开。
const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.resolve(__dirname, '../../..');
const DEFINE_RE = /^\{\{define "([^"]+)"\}\}\n([\s\S]*)\n\{\{end\}\}\n?$/;

function listTemplateFiles() {
  const files = [];
  for (const entry of fs.readdirSync(WEB_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(WEB_ROOT, entry.name, 'templates');
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.html')) files.push(path.join(dir, name));
    }
  }
  return files.sort();
}

// readTemplatePartials 读取全部模块片段，键为 {{define}} 名称。
function readTemplatePartials() {
  const partials = new Map();
  for (const file of listTemplateFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const matched = DEFINE_RE.exec(text);
    if (matched) partials.set(matched[1], matched[2]);
  }
  return partials;
}

// readAllTemplates 按壳层 include 顺序展开所有片段，结果与浏览器实际 DOM 顺序一致。
function readAllTemplates() {
  const partials = readTemplatePartials();
  const shell = fs.readFileSync(path.join(WEB_ROOT, 'core', 'templates', 'index.html'), 'utf8');
  return shell.replace(/\{\{template "([^"]+)" \.\}\}/g, (match, name) =>
    partials.has(name) ? partials.get(name) : match
  );
}

module.exports = { readAllTemplates, readTemplatePartials, listTemplateFiles };
