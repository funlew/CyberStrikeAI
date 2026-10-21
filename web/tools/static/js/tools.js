// 工具状态 & 工具管理相关功能（参照 skills.js 实现）
function toolsT(key, opts) {
    return typeof window.t === 'function' ? window.t(key, opts) : key;
}

function toolsEscapeHtml(value) {
    if (typeof escapeHtml === 'function') {
        return escapeHtml(value);
    }
    const s = value == null ? '' : String(value);
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toolsEscapeAttr(value) {
    if (typeof escapeAttr === 'function') {
        return escapeAttr(value);
    }
    return toolsEscapeHtml(value).replace(/"/g, '&quot;');
}

function formatToolsTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ==================== 工具状态页 ====================
let toolsStatusData = null;

function isToolsStatusPageActive() {
    const page = document.getElementById('page-tools-status');
    return !!(page && page.classList.contains('active'));
}

async function loadToolsStatus() {
    const statsEl = document.getElementById('tools-status-stats');
    const listEl = document.getElementById('tools-status-list');
    try {
        const response = await apiFetch('/api/config/tool-stats');
        if (!response.ok) {
            throw new Error('加载工具状态失败');
        }
        toolsStatusData = await response.json();
        renderToolsStatus();
    } catch (error) {
        console.error('加载工具状态失败:', error);
        if (statsEl) statsEl.innerHTML = '<div class="monitor-error">加载失败: ' + toolsEscapeHtml(error.message) + '</div>';
        if (listEl) listEl.innerHTML = '<div class="monitor-error">加载失败: ' + toolsEscapeHtml(error.message) + '</div>';
    }
}

function renderToolsStatus() {
    const data = toolsStatusData || {};
    const statsEl = document.getElementById('tools-status-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">工具总数</div>
                <div class="monitor-stat-value">${data.total || 0}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">已启用</div>
                <div class="monitor-stat-value is-success">${data.enabled || 0}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">已禁用</div>
                <div class="monitor-stat-value is-danger">${data.disabled || 0}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">调用总数</div>
                <div class="monitor-stat-value">${data.total_calls || 0}</div>
            </div>
            <div class="monitor-stat-card">
                <div class="monitor-stat-label">调用成功率</div>
                <div class="monitor-stat-value">${data.total_calls > 0 ? (((data.success_calls || 0) / data.total_calls) * 100).toFixed(1) : '0.0'}%</div>
            </div>
        `;
    }

    const listEl = document.getElementById('tools-status-list');
    if (!listEl) return;
    const tools = Array.isArray(data.tools) ? data.tools : [];
    if (tools.length === 0) {
        listEl.innerHTML = '<div class="monitor-empty">暂无工具数据</div>';
        return;
    }
    listEl.innerHTML = `
        <table class="monitor-table skills-monitor-table">
            <thead>
                <tr>
                    <th>工具名称</th>
                    <th>状态</th>
                    <th>来源</th>
                    <th>调用</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>成功率</th>
                    <th>最后调用</th>
                </tr>
            </thead>
            <tbody>
                ${tools.map(tool => {
                    const calls = tool.calls || 0;
                    const success = tool.success || 0;
                    const failed = tool.failed || 0;
                    const rate = calls > 0 ? ((success / calls) * 100).toFixed(1) : '0.0';
                    return `
                        <tr>
                            <td><strong>${toolsEscapeHtml(tool.name)}</strong></td>
                            <td><span class="${tool.enabled ? 'is-success' : 'is-danger'}">${tool.enabled ? '启用' : '禁用'}</span></td>
                            <td>${tool.source === 'dir' ? '目录' : '内联'}</td>
                            <td><span class="skills-table-pill">${calls}</span></td>
                            <td><span class="skills-table-number is-success">${success}</span></td>
                            <td><span class="skills-table-number is-danger">${failed}</span></td>
                            <td>${rate}%</td>
                            <td class="skills-last-call">${toolsEscapeHtml(formatToolsTime(tool.last_call_time))}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

async function refreshToolsStatus() {
    await loadToolsStatus();
    if (typeof showNotification === 'function') {
        showNotification('工具状态已刷新', 'success');
    }
}

// ==================== 工具管理页 ====================
let toolsAll = [];
let toolsSearchKeyword = '';
let toolsSearchTimeout = null;
let toolsPagination = { currentPage: 1, pageSize: 20 };

function getToolsPageSize() {
    try {
        const saved = localStorage.getItem('toolsPageSize');
        if (saved) {
            const size = parseInt(saved, 10);
            if (size > 0) return size;
        }
    } catch (e) { /* ignore */ }
    return 20;
}

function initToolsManagement() {
    toolsPagination.pageSize = getToolsPageSize();
    toolsPagination.currentPage = 1;
    toolsSearchKeyword = '';
    const input = document.getElementById('tools-search');
    if (input) input.value = '';
    const clearBtn = document.getElementById('tools-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    loadToolsManagementData();
}

async function loadToolsManagementData() {
    try {
        const response = await apiFetch('/api/config/tool-stats');
        if (!response.ok) {
            throw new Error('加载工具列表失败');
        }
        const data = await response.json();
        toolsAll = Array.isArray(data.tools) ? data.tools : [];
        updateToolsManagementStats(data);
        renderToolsList();
        renderToolsPagination();
    } catch (error) {
        console.error('加载工具列表失败:', error);
        const listEl = document.getElementById('tools-list');
        if (listEl) {
            listEl.innerHTML = '<div class="empty-state">加载失败: ' + toolsEscapeHtml(error.message) + '</div>';
        }
        if (typeof showNotification === 'function') {
            showNotification('加载工具列表失败: ' + error.message, 'error');
        }
    }
}

function updateToolsManagementStats(data) {
    const totalEl = document.getElementById('tools-total-count');
    const enabledEl = document.getElementById('tools-enabled-count');
    const disabledEl = document.getElementById('tools-disabled-count');
    const callsEl = document.getElementById('tools-calls-count');
    if (totalEl) totalEl.textContent = data.total || 0;
    if (enabledEl) enabledEl.textContent = data.enabled || 0;
    if (disabledEl) disabledEl.textContent = data.disabled || 0;
    if (callsEl) callsEl.textContent = data.total_calls || 0;
}

function filteredTools() {
    const kw = toolsSearchKeyword.trim().toLowerCase();
    if (!kw) return toolsAll;
    return toolsAll.filter(tool => {
        return String(tool.name || '').toLowerCase().includes(kw);
    });
}

function renderToolsList() {
    const listEl = document.getElementById('tools-list');
    if (!listEl) return;
    const filtered = filteredTools();
    const pageSize = toolsPagination.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (toolsPagination.currentPage > totalPages) toolsPagination.currentPage = totalPages;
    const start = (toolsPagination.currentPage - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="empty-state">' + (toolsSearchKeyword ? '没有匹配的工具' : '暂无工具') + '</div>';
        const paginationContainer = document.getElementById('tools-pagination');
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    listEl.innerHTML = pageItems.map(tool => {
        const name = tool.name || '';
        const sourceLabel = tool.source === 'dir' ? '目录' : '内联';
        const statusLabel = tool.enabled ? '已启用' : '已禁用';
        const statusClass = tool.enabled ? 'is-success' : 'is-danger';
        const editable = !!tool.has_file;
        return `
            <div class="skill-card">
                <div class="skill-card-body">
                    <div class="skill-card-header">
                        <div class="skill-card-title-row">
                            <h3 class="skill-card-title">${toolsEscapeHtml(name)}</h3>
                            <div class="skill-card-meta">
                                <span class="${statusClass}">${statusLabel}</span>
                                <span>${sourceLabel}</span>
                                <span>调用 ${tool.calls || 0}</span>
                            </div>
                        </div>
                        <div class="skill-card-description">${editable ? '目录工具，可编辑 YAML 配置' : '内联工具，请在 config.yaml 中维护'}</div>
                    </div>
                    <div class="skill-card-actions">
                        <button type="button" class="btn-secondary btn-small" ${editable ? '' : 'disabled'} data-tool-edit="${toolsEscapeAttr(name)}">编辑</button>
                        <button type="button" class="btn-secondary btn-small btn-danger" ${editable ? '' : 'disabled'} data-tool-delete="${toolsEscapeAttr(name)}">删除</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('[data-tool-edit]').forEach(btn => {
        btn.addEventListener('click', () => editTool(btn.getAttribute('data-tool-edit')));
    });
    listEl.querySelectorAll('[data-tool-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteTool(btn.getAttribute('data-tool-delete')));
    });
}

function renderToolsPagination() {
    const container = document.getElementById('tools-pagination');
    if (!container) return;
    const filtered = filteredTools();
    const total = filtered.length;
    const pageSize = toolsPagination.pageSize;
    const currentPage = toolsPagination.currentPage;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (total === 0) {
        container.innerHTML = '';
        return;
    }
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, total);

    container.innerHTML = `
        <div class="pagination">
            <div class="pagination-info">
                <span>显示 ${start}-${end}，共 ${total} 项</span>
                <label class="pagination-page-size">
                    每页
                    <select id="tools-page-size-pagination" onchange="changeToolsPageSize()">
                        <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                    </select>
                </label>
            </div>
            <div class="pagination-controls">
                <button class="btn-secondary" onclick="gotoToolsPage(1)" ${currentPage === 1 ? 'disabled' : ''}>首页</button>
                <button class="btn-secondary" onclick="gotoToolsPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>
                <span class="pagination-page">第 ${currentPage}/${totalPages} 页</span>
                <button class="btn-secondary" onclick="gotoToolsPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
                <button class="btn-secondary" onclick="gotoToolsPage(${totalPages})" ${currentPage >= totalPages ? 'disabled' : ''}>末页</button>
            </div>
        </div>
    `;
}

function gotoToolsPage(page) {
    toolsPagination.currentPage = page;
    renderToolsList();
    renderToolsPagination();
}

function changeToolsPageSize() {
    const select = document.getElementById('tools-page-size-pagination');
    if (!select) return;
    const size = parseInt(select.value, 10) || 20;
    toolsPagination.pageSize = size;
    toolsPagination.currentPage = 1;
    try { localStorage.setItem('toolsPageSize', String(size)); } catch (e) { /* ignore */ }
    renderToolsList();
    renderToolsPagination();
}

function handleToolsSearchInput() {
    const input = document.getElementById('tools-search');
    const clearBtn = document.getElementById('tools-search-clear');
    if (input) {
        if (clearBtn) clearBtn.style.display = input.value ? 'block' : 'none';
    }
    if (toolsSearchTimeout) clearTimeout(toolsSearchTimeout);
    toolsSearchTimeout = setTimeout(() => {
        toolsSearchKeyword = input ? input.value.trim() : '';
        toolsPagination.currentPage = 1;
        renderToolsList();
        renderToolsPagination();
    }, 250);
}

function searchTools() {
    const input = document.getElementById('tools-search');
    toolsSearchKeyword = input ? input.value.trim() : '';
    toolsPagination.currentPage = 1;
    renderToolsList();
    renderToolsPagination();
}

function clearToolsSearch() {
    const input = document.getElementById('tools-search');
    if (input) input.value = '';
    const clearBtn = document.getElementById('tools-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    toolsSearchKeyword = '';
    toolsPagination.currentPage = 1;
    renderToolsList();
    renderToolsPagination();
}

async function refreshToolsManagement() {
    await loadToolsManagementData();
    if (typeof showNotification === 'function') {
        showNotification('工具列表已刷新', 'success');
    }
}

// ==================== 工具配置弹窗 ====================
let toolModalAddMode = true;
let isSavingTool = false;

function openToolModal() {
    const modal = document.getElementById('tool-modal');
    if (!modal) return;
    if (typeof openAppModal === 'function') {
        openAppModal('tool-modal');
    } else {
        modal.style.display = 'flex';
    }
}

function closeToolModal() {
    const modal = document.getElementById('tool-modal');
    if (!modal) return;
    if (typeof closeAppModal === 'function') {
        closeAppModal('tool-modal');
    } else {
        modal.style.display = 'none';
    }
}

function showCreateToolModal() {
    if (typeof requirePermission === 'function' && !requirePermission('config:write')) return;
    toolModalAddMode = true;
    const titleEl = document.getElementById('tool-modal-title');
    if (titleEl) titleEl.textContent = '新建工具';
    const nameRow = document.getElementById('tool-modal-name-row');
    if (nameRow) nameRow.style.display = '';
    const nameInput = document.getElementById('tool-modal-name');
    if (nameInput) nameInput.value = '';
    const currentInput = document.getElementById('tool-modal-name-current');
    if (currentInput) currentInput.value = '';
    const content = document.getElementById('tool-modal-content');
    if (content) {
        content.value = 'name: "my_tool"\ncommand: "my-command"\nenabled: true\n\nshort_description: "一句话说明工具用途"\n\ndescription: |\n  工具详细描述。\n\nparameters:\n  - name: "target"\n    type: "string"\n    description: "目标参数"\n    required: true\n    position: 0\n    format: "positional"\n';
    }
    openToolModal();
}

async function editTool(name) {
    if (typeof requirePermission === 'function' && !requirePermission('config:write')) return;
    try {
        const response = await apiFetch('/api/config/tools/' + encodeURIComponent(name));
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || '读取工具配置失败');
        }
        const data = await response.json();
        if (!data.has_file) {
            if (typeof showNotification === 'function') {
                showNotification('该工具为 config.yaml 内联工具，请在主配置中维护', 'error');
            }
            return;
        }
        toolModalAddMode = false;
        const titleEl = document.getElementById('tool-modal-title');
        if (titleEl) titleEl.textContent = '编辑工具 - ' + name;
        const nameRow = document.getElementById('tool-modal-name-row');
        if (nameRow) nameRow.style.display = 'none';
        const currentInput = document.getElementById('tool-modal-name-current');
        if (currentInput) currentInput.value = name;
        const nameInput = document.getElementById('tool-modal-name');
        if (nameInput) nameInput.value = name;
        const content = document.getElementById('tool-modal-content');
        if (content) content.value = data.content || '';
        openToolModal();
    } catch (error) {
        console.error('读取工具配置失败:', error);
        if (typeof showNotification === 'function') {
            showNotification('读取工具配置失败: ' + error.message, 'error');
        }
    }
}

async function saveToolConfig() {
    if (isSavingTool) return;
    if (typeof requirePermission === 'function' && !requirePermission('config:write')) return;
    const nameInput = document.getElementById('tool-modal-name');
    const contentEl = document.getElementById('tool-modal-content');
    const currentInput = document.getElementById('tool-modal-name-current');
    const content = contentEl ? contentEl.value : '';
    if (!content.trim()) {
        if (typeof showNotification === 'function') showNotification('工具配置内容不能为空', 'error');
        return;
    }

    isSavingTool = true;
    try {
        let response;
        if (toolModalAddMode) {
            const name = nameInput ? nameInput.value.trim() : '';
            if (!name) {
                if (typeof showNotification === 'function') showNotification('请填写工具名', 'error');
                isSavingTool = false;
                return;
            }
            response = await apiFetch('/api/config/tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, content })
            });
        } else {
            const name = currentInput ? currentInput.value : '';
            response = await apiFetch('/api/config/tools/' + encodeURIComponent(name), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
        }
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || '保存工具失败');
        }
        if (typeof showNotification === 'function') showNotification('工具配置已保存', 'success');
        closeToolModal();
        await loadToolsManagementData();
        if (isToolsStatusPageActive()) {
            await loadToolsStatus();
        }
    } catch (error) {
        console.error('保存工具失败:', error);
        if (typeof showNotification === 'function') {
            showNotification('保存工具失败: ' + error.message, 'error');
        }
    } finally {
        isSavingTool = false;
    }
}

async function deleteTool(name) {
    if (typeof requirePermission === 'function' && !requirePermission('config:delete')) return;
    if (!confirm('确定删除工具 "' + name + '" 吗？该操作会删除 tools 目录下的配置文件。')) {
        return;
    }
    try {
        const response = await apiFetch('/api/config/tools/' + encodeURIComponent(name), {
            method: 'DELETE'
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || '删除工具失败');
        }
        if (typeof showNotification === 'function') showNotification('工具已删除', 'success');
        await loadToolsManagementData();
        if (isToolsStatusPageActive()) {
            await loadToolsStatus();
        }
    } catch (error) {
        console.error('删除工具失败:', error);
        if (typeof showNotification === 'function') {
            showNotification('删除工具失败: ' + error.message, 'error');
        }
    }
}
