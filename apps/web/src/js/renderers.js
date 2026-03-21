import { api, fetchHealth } from "./api.js";
import { dom } from "./dom.js";
import { activeView, appState, filteredUpstreams } from "./state.js";
import { cardMetric, formatDate, renderList, requestSummaryMarkup, showJson } from "./utils.js";

export function setPageTitle(viewName) {
  const titles = {
    dashboard: "软体总览",
    upstreams: "上游工坊",
    users: "成员与配额",
    audit: "审计丝带",
    portal: "我的口袋"
  };
  const title = titles[viewName] ?? "Agent Proxy";
  dom.pageTitle.textContent = title;
  dom.breadcrumbCurrent.textContent = title;
}

export function activateView(viewName) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  setPageTitle(viewName);
}

export function openModal(preset = null) {
  dom.authModal.classList.add("is-open");
  if (preset) {
    dom.loginEmailInput.value = preset.email;
    dom.loginPasswordInput.value = preset.password;
  }
}

export function closeModal() {
  dom.authModal.classList.remove("is-open");
}

export function setUpstreamAlert(message = "") {
  dom.upstreamAlert.textContent = message;
  dom.upstreamAlert.classList.toggle("hidden", !message);
}

export function setUpstreamTab(tabName) {
  appState.upstreamTab = tabName;
  dom.upstreamTabs.querySelectorAll("[data-upstream-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.upstreamTab === tabName);
  });
}

export function syncRoleVisibility() {
  const isAdmin = appState.user?.role === "admin";
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("is-disabled", !isAdmin);
  });

  if (!isAdmin && ["upstreams", "users", "audit"].includes(activeView())) {
    activateView(appState.user ? "portal" : "dashboard");
  }
}

export function setSession(session) {
  appState.token = session?.token ?? "";
  appState.user = session?.user ?? null;

  if (appState.user) {
    dom.currentUser.textContent = appState.user.displayName;
    dom.currentRole.textContent = `${appState.user.role} · ${appState.user.email}`;
    dom.profileAvatar.textContent = appState.user.displayName.slice(0, 1).toUpperCase();
    dom.openAuthButton.textContent = "切换身份";
    dom.logoutButton.classList.remove("hidden");
    closeModal();
  } else {
    dom.currentUser.textContent = "未登录";
    dom.currentRole.textContent = "soft idle";
    dom.profileAvatar.textContent = "A";
    dom.openAuthButton.textContent = "登录";
    dom.logoutButton.classList.add("hidden");
  }

  showJson(dom.sessionOutput, session ?? { message: "当前还没有会话" });
  syncRoleVisibility();
}

export function showError(error) {
  dom.sessionOutput.textContent = error instanceof Error ? error.message : String(error);
}

export function fillQuotaForm(user) {
  appState.selectedUserId = user.id;
  dom.quotaPanelTitle.textContent = `为 ${user.displayName} 配置配额`;
  dom.userActionTitle.textContent = `${user.displayName} 的账户动作`;
  dom.quotaModeInput.value = user.quota.mode;
  dom.quotaMonthlyInput.value = user.quota.monthlyTokenLimit ?? "";
  dom.quotaRemainingInput.value = user.quota.remainingTokens ?? "";
  showJson(dom.quotaFormOutput, user.quota);
  dom.userDetailCard.innerHTML = `
    <div class="summary-row"><span>邮箱</span><strong>${user.email}</strong></div>
    <div class="summary-row"><span>角色</span><strong>${user.role}</strong></div>
    <div class="summary-row"><span>状态</span><strong>${user.isActive ? "已启用" : "已禁用"}</strong></div>
    <div class="summary-row"><span>额度</span><strong>${user.quota.mode === "unlimited" ? "无限额度" : `剩余 ${user.quota.remainingTokens}`}</strong></div>
  `;
  dom.issueKeyOutput.textContent = `当前已选择用户：${user.displayName}`;
  dom.toggleUserButton.textContent = user.isActive ? "禁用当前用户" : "启用当前用户";
}

export function fillUpstreamForm(upstream) {
  appState.selectedUpstreamId = upstream.id;
  dom.upstreamNameInput.value = upstream.name;
  dom.upstreamProviderInput.value = upstream.provider;
  dom.upstreamBaseUrlInput.value = upstream.baseUrl;
  dom.upstreamApiKeyInput.value = "";
  dom.upstreamDefaultModelInput.value = upstream.defaultModel;
  dom.upstreamPriorityInput.value = upstream.priority;
  dom.upstreamProtocolInput.value = "openai";
  dom.upstreamMappingDefaultInput.value = upstream.defaultModel;
  dom.upstreamSubmitButton.textContent = "更新上游配置";
  dom.upstreamToggleButton.textContent = upstream.isActive ? "停用当前上游" : "启用当前上游";
  showJson(dom.upstreamFormOutput, upstream);
}

export function resetUpstreamForm() {
  appState.selectedUpstreamId = null;
  dom.upstreamForm.reset();
  dom.upstreamPriorityInput.value = 100;
  dom.upstreamSubmitButton.textContent = "保存上游配置";
  dom.upstreamToggleButton.textContent = "先选择一个上游";
  dom.upstreamFormOutput.textContent = "等待提交";
  setUpstreamAlert("");
}

export function renderAuditDetail(detail) {
  dom.auditDetailTitle.textContent = `${detail.request.requestedModel} -> ${detail.request.mappedModel}`;
  dom.auditDetail.innerHTML = `
    <div class="audit-summary">
      <div class="summary-row"><span>协议</span><strong>${detail.request.protocol}</strong></div>
      <div class="summary-row"><span>状态</span><strong>${detail.request.status}</strong></div>
      <div class="summary-row"><span>耗时</span><strong>${detail.request.latencyMs} ms</strong></div>
      <div class="summary-row"><span>用量</span><strong>${detail.usage.inputTokens + detail.usage.outputTokens} tokens</strong></div>
    </div>
    <div class="timeline">
      ${detail.timeline.map((event) => `
        <article class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-card">
            <div class="record-head">
              <span class="tag">${event.type}</span>
              <span class="subtle">${new Date(event.createdAt).toLocaleTimeString()}</span>
            </div>
            <pre class="trace">${JSON.stringify(event.payload, null, 2)}</pre>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

export async function showRequestDetail(requestId, scope = "admin") {
  const detail = await api(scope === "admin" ? `/admin/requests/${requestId}` : `/me/requests/${requestId}`);
  appState.selectedRequestId = requestId;
  renderAuditDetail(detail);
}

export function bindRequestButtons(scope = "admin") {
  document.querySelectorAll("[data-request-id]").forEach((button) => {
    button.addEventListener("click", () => {
      showRequestDetail(button.dataset.requestId, scope).catch(showError);
    });
  });
}

export function bindUserButtons() {
  document.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = appState.users.find((item) => item.id === button.dataset.userId);
      if (user) {
        fillQuotaForm(user);
      }
    });
  });
}

export function bindUpstreamButtons() {
  document.querySelectorAll("[data-upstream-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const upstream = appState.upstreams.find((item) => item.id === button.dataset.upstreamId);
      if (upstream) {
        fillUpstreamForm(upstream);
      }
    });
  });
}

export async function refreshHealth() {
  try {
    const health = await fetchHealth();
    dom.systemStatus.textContent = health.ok ? "柔软运行中" : "异常";
    dom.systemTime.textContent = `最新心跳 ${new Date(health.now).toLocaleString()}`;
  } catch {
    dom.systemStatus.textContent = "不可用";
    dom.systemTime.textContent = "无法连接到服务";
  }
}

export async function refreshSelectedUserKeys(refreshAdmin, refreshUser) {
  if (!appState.selectedUserId || appState.user?.role !== "admin") {
    renderList(dom.userApiKeyList, [], () => "", "这里会显示当前用户的协议专属 Key。");
    return;
  }
  const keys = await api(`/admin/users/${appState.selectedUserId}/api-keys`);
  appState.userApiKeys = keys;
  renderList(dom.userApiKeyList, keys, (item) => `
    <div class="record-head">
      <strong>${item.name}</strong>
      <span class="tag">${item.protocol}</span>
    </div>
    <p class="muted">${item.prefix}******</p>
    <div class="record-meta">
      <span>${item.isActive ? "启用中" : "已撤销"}</span>
      <button class="ghost compact-button" data-revoke-key-id="${item.id}">撤销</button>
    </div>
  `, "当前用户还没有 API Key。");

  document.querySelectorAll("[data-revoke-key-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const result = await api(`/admin/users/${appState.selectedUserId}/api-keys/${button.dataset.revokeKeyId}`, {
          method: "DELETE"
        });
        showJson(dom.issueKeyOutput, result);
        await Promise.all([refreshAdmin(), refreshUser()]);
      } catch (error) {
        dom.issueKeyOutput.textContent = error instanceof Error ? error.message : String(error);
      }
    });
  });
}

export async function refreshAdmin(refreshUser) {
  if (appState.user?.role !== "admin") {
    dom.metrics.innerHTML = [
      cardMetric("登录状态", "需要管理员", "登录后可查看上游、用户、配额和审计信息。", "peach"),
      cardMetric("当前模式", appState.user?.role ?? "访客", "管理员模块会在登录后解锁。", "mint"),
      cardMetric("操作区", "未启用", "右侧配置面板需要管理员权限。", "sky"),
      cardMetric("审计区", "未启用", "请求详情只有管理员可见。", "lilac")
    ].join("");
    renderList(dom.providerHealth, [], () => "", "请先登录管理员。");
    renderList(dom.recentRequests, [], () => "", "请先登录管理员。");
    renderList(dom.upstreams, [], () => "", "请先登录管理员。");
    renderList(dom.users, [], () => "", "请先登录管理员。");
    renderList(dom.requestList, [], () => "", "请先登录管理员。");
    dom.upstreamCount.textContent = "0";
    dom.activeUpstreamCount.textContent = "0";
    dom.userCount.textContent = "0";
    dom.quotaUserCount.textContent = "0";
    setUpstreamAlert(activeView() === "upstreams" ? "请先切换到管理员身份。" : "");
    return;
  }

  const dashboard = await api("/admin/dashboard");
  const upstreamData = await api("/admin/upstreams");
  const usersData = await api("/admin/users");
  const requests = await api("/admin/requests");

  appState.users = usersData;
  appState.upstreams = upstreamData;
  setUpstreamAlert("");
  dom.upstreamCount.textContent = String(upstreamData.length);
  dom.activeUpstreamCount.textContent = String(upstreamData.filter((item) => item.isActive).length);
  dom.userCount.textContent = String(usersData.filter((item) => item.isActive).length);
  dom.quotaUserCount.textContent = String(usersData.filter((item) => item.quota?.mode === "limited").length);

  dom.metrics.innerHTML = [
    cardMetric("总请求数", dashboard.totals.requests, "所有代理请求累计。", "peach"),
    cardMetric("成功率", `${Math.round(dashboard.totals.successRate * 100)}%`, "已成功完成的请求占比。", "mint"),
    cardMetric("活跃用户", dashboard.totals.activeUsers, "当前启用中的用户数量。", "sky"),
    cardMetric("月度 Token", dashboard.totals.monthlyTokens, "按 usage ledger 汇总。", "lilac")
  ].join("");

  renderList(dom.providerHealth, dashboard.providerHealth, (item) => `
    <div class="record-head">
      <strong>${item.provider}</strong>
      <span class="tag ${item.status === "healthy" ? "good" : "warn"}">${item.status}</span>
    </div>
    <p class="muted">平均延迟 ${item.avgLatencyMs} ms</p>
  `, "暂无上游健康数据。");

  renderList(dom.recentRequests, dashboard.recentRequests, requestSummaryMarkup, "暂无请求。");
  bindRequestButtons("admin");

  renderList(dom.upstreams, filteredUpstreams(), (item) => `
    <button class="record-button ${item.id === appState.selectedUpstreamId ? "selected" : ""}" data-upstream-id="${item.id}">
      <div class="record-head">
        <strong>${item.name}</strong>
        <span class="tag">${item.provider}</span>
      </div>
      <p>${item.baseUrl}</p>
      <div class="record-meta">
        <span>默认模型 ${item.defaultModel}</span>
        <span>优先级 ${item.priority}</span>
      </div>
      <div class="record-meta">
        <span>${item.apiKeyMasked}</span>
        <span>${item.isActive ? "启用中" : "已停用"}</span>
      </div>
    </button>
  `, appState.upstreamTab === "active" ? "暂无启用中的上游。" : "暂无上游配置。");
  bindUpstreamButtons();

  renderList(dom.users, usersData, (item) => `
    <button class="record-button ${item.id === appState.selectedUserId ? "selected" : ""}" data-user-id="${item.id}">
      <div class="record-head">
        <strong>${item.displayName}</strong>
        <span class="tag">${item.role}</span>
      </div>
      <p>${item.email}</p>
      <div class="record-meta">
        <span>${item.isActive ? "已启用" : "已禁用"}</span>
        <span>${item.quota.mode === "unlimited" ? "无限额度" : `剩余 ${item.quota.remainingTokens}`}</span>
      </div>
    </button>
  `, "暂无用户。");
  bindUserButtons();
  await refreshSelectedUserKeys(() => refreshAdmin(refreshUser), refreshUser);

  renderList(dom.requestList, requests, (item) => requestSummaryMarkup({
    ...item,
    isSelected: item.id === appState.selectedRequestId
  }), "暂无可审计请求。");
  bindRequestButtons("admin");

  if (!appState.selectedUserId && usersData.length > 0) {
    fillQuotaForm(usersData.find((item) => item.role !== "admin") ?? usersData[0]);
  }
}

export async function refreshUser() {
  if (!appState.user) {
    renderList(dom.meKeys, [], () => "", "登录后查看你的 API Key。");
    renderList(dom.meUsage, [], () => "", "登录后查看你的用量。");
    return;
  }

  const keys = await api("/me/api-keys");
  const usage = await api("/me/usage");

  renderList(dom.meKeys, keys, (item) => `
    <div class="record-head">
      <strong>${item.name}</strong>
      <span class="tag">${item.protocol}</span>
    </div>
    <p class="muted">${item.prefix}******</p>
    <div class="record-meta">
      <span>${formatDate(item.createdAt)}</span>
      <span>${item.isActive ? "启用中" : "已撤销"}</span>
    </div>
  `, "暂无 API Key。");

  renderList(dom.meUsage, usage.entries, (item) => `
    <button class="record-button" data-request-id="${item.requestId}">
      <div class="record-head">
        <strong>${item.provider}</strong>
        <span class="tag">${item.inputTokens + item.outputTokens} tok</span>
      </div>
      <p class="muted">预估 $${item.estimatedCostUsd.toFixed(4)}</p>
      <div class="record-meta">
        <span>${formatDate(item.createdAt)}</span>
        <span>输出 ${item.outputTokens}</span>
      </div>
    </button>
  `, "暂无用量记录。");
  bindRequestButtons("me");
}
