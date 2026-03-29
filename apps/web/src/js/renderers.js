import { api, fetchHealth } from "./api.js";
import { dom } from "./dom.js";
import { getLanguage, t, translateTree } from "./i18n.js";
import { activeView, appState, filteredUpstreams, selectedApiKey } from "./state.js";
import { cardMetric, formatDate, formatTime, renderList, requestSummaryMarkup, showJson } from "./utils.js";

const SESSION_STORAGE_KEY = "agent-proxy-session";

function zhEn(zh, en) {
  return getLanguage() === "en" ? en : zh;
}

function persistSession(session) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    if (session?.token && session?.user) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        token: session.token,
        user: session.user
      }));
      return;
    }
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the in-memory session working.
  }
}

export function getStoredSession() {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const session = JSON.parse(raw);
    if (!session || typeof session.token !== "string" || !session.token || typeof session.user !== "object") {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    return {
      token: session.token,
      user: session.user
    };
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function stripUpstreamProvider(upstream) {
  if (!upstream || typeof upstream !== "object" || Array.isArray(upstream)) {
    return upstream;
  }

  const { provider, ...rest } = upstream;
  return rest;
}

function endpointForProtocol(protocol) {
  return `${window.location.origin}${protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions"}`;
}

function endpointPathForProtocol(protocol) {
  return protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
}

function apiKeyHeaderExample(protocol, key) {
  if (protocol === "openai") {
    return `Authorization: Bearer ${key}`;
  }
  return `x-api-key: ${key}`;
}

function keyBindingLabel(record) {
  return record.upstreamName ? `Bound: ${record.upstreamName}` : "Bound: Auto";
}

function displayText(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function formatLatency(value) {
  return Number.isFinite(Number(value)) ? `${Number(value)} ms` : "-";
}

function formatUsageTotal(usage) {
  const inputTokens = Number(usage?.inputTokens);
  const outputTokens = Number(usage?.outputTokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) {
    return "-";
  }
  return `${(Number.isFinite(inputTokens) ? inputTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : 0)} tokens`;
}

function setAuditEmptyState(message = zhEn("从左侧选择一条请求查看审计详情。", "Select a request to inspect its audit trace.")) {
  dom.auditDetailTitle.textContent = zhEn("选择一条请求", "Select a Request");
  dom.auditDetail.innerHTML = `<p class="empty">${message}</p>`;
}

function appendSummaryRow(container, label, value) {
  const row = document.createElement("div");
  row.className = "summary-row";

  const labelNode = document.createElement("span");
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.textContent = value;

  row.append(labelNode, valueNode);
  container.appendChild(row);
}

function buildTimelineItem(event) {
  const article = document.createElement("article");
  article.className = "timeline-item";

  const dot = document.createElement("div");
  dot.className = "timeline-dot";

  const card = document.createElement("div");
  card.className = "timeline-card";

  const head = document.createElement("div");
  head.className = "record-head";

  const typeTag = document.createElement("span");
  typeTag.className = "tag";
  typeTag.textContent = displayText(event?.type);

  const timeNode = document.createElement("span");
  timeNode.className = "subtle";
  timeNode.textContent = formatTime(event?.createdAt);

  const payload = document.createElement("pre");
  payload.className = "trace";
  payload.textContent = JSON.stringify(event?.payload ?? {}, null, 2);

  head.append(typeTag, timeNode);
  card.append(head, payload);
  article.append(dot, card);
  return article;
}

function syncSelectedRequestList(requestId) {
  dom.requestList.querySelectorAll("[data-request-id]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.requestId === requestId);
  });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function markButtonCopied(button, copiedLabel = "Copied") {
  const original = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = original;
  button.textContent = copiedLabel;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function bindApiKeyCopyButtons(scope = document) {
  scope.querySelectorAll("[data-copy-value]").forEach((button) => {
    if (button.dataset.copyBound === "true") {
      return;
    }
    button.dataset.copyBound = "true";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await copyText(button.dataset.copyValue);
        markButtonCopied(button, button.dataset.copiedLabel || "Copied");
      } catch {
        markButtonCopied(button, "Copy Failed");
      }
    });
  });
}

function bindSnippetCopyButtons(scope = document) {
  scope.querySelectorAll("[data-copy-snippet-target]").forEach((button) => {
    if (button.dataset.copyBound === "true") {
      return;
    }
    button.dataset.copyBound = "true";
    button.addEventListener("click", async () => {
      const target = scope.querySelector(`#${button.dataset.copySnippetTarget}`);
      if (!target) {
        markButtonCopied(button, "Missing");
        return;
      }
      try {
        await copyText(target.textContent);
        markButtonCopied(button, `${button.dataset.copyLabel || "Snippet"} Copied`);
      } catch {
        markButtonCopied(button, "Copy Failed");
      }
    });
  });
}

function routeBindingOptionsMarkup(selectedValue = "") {
  return [
    `<option value="" ${!selectedValue ? "selected" : ""}>Auto Select By Protocol And Priority</option>`,
    ...appState.upstreams
      .filter((item) => item.isActive)
      .map((item) => `<option value="${item.id}" ${item.id === selectedValue ? "selected" : ""}>${item.name} · ${item.defaultModel}</option>`)
  ].join("");
}

function buildIntegrationSnippets(protocol, plainTextKey, baseUrl) {
  if (protocol === "anthropic") {
    return [
      {
        id: "claude-code",
        title: "Claude Code",
        note: "Requires a Claude Code install that supports custom Anthropic base URLs.",
        body: `export ANTHROPIC_BASE_URL=${baseUrl}
export ANTHROPIC_AUTH_TOKEN=${plainTextKey}
claude`
      },
      {
        id: "curl",
        title: "curl",
        note: "Raw Anthropic-compatible request",
        body: `curl ${baseUrl}/v1/messages \\
  -H "content-type: application/json" \\
  -H "x-api-key: ${plainTextKey}" \\
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"hello"}]
  }'`
      },
      {
        id: "sdk",
        title: "Anthropic SDK",
        note: "Anthropic-compatible base URL example",
        body: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "${plainTextKey}",
  baseURL: "${baseUrl}"
});

const response = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "hello" }]
});

console.log(response.content);`
      }
    ];
  }

  return [
    {
      id: "curl",
      title: "curl",
      note: "Raw OpenAI-compatible request",
      body: `curl ${baseUrl}/v1/chat/completions \\
  -H "content-type: application/json" \\
  -H "Authorization: Bearer ${plainTextKey}" \\
  -d '{
    "model": "gpt-4.1",
    "messages": [{"role":"user","content":"hello"}]
  }'`
    },
    {
      id: "sdk",
      title: "OpenAI SDK",
      note: "JavaScript client example",
      body: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${plainTextKey}",
  baseURL: "${baseUrl}/v1"
});

const response = await client.chat.completions.create({
  model: "gpt-4.1",
  messages: [{ role: "user", content: "hello" }]
});

console.log(response.choices[0].message.content);`
    }
  ];
}

export function syncIssueKeyUpstreamOptions() {
  const currentValue = dom.issueKeyUpstreamInput.value;
  const options = [
    '<option value="">Auto Select By Protocol And Priority</option>',
    ...appState.upstreams
      .filter((item) => item.isActive)
      .map((item) => `<option value="${item.id}">${item.name} · ${item.defaultModel}</option>`)
  ];
  dom.issueKeyUpstreamInput.innerHTML = options.join("");
  if (currentValue && appState.upstreams.some((item) => item.id === currentValue && item.isActive)) {
    dom.issueKeyUpstreamInput.value = currentValue;
  }
}

export function syncIssueKeyUserOptions() {
  const currentValue = dom.issueKeyUserInput.value;
  const preferredValue = appState.selectedUserId && appState.users.some((item) => item.id === appState.selectedUserId)
    ? appState.selectedUserId
    : "";
  const nextValue = currentValue || preferredValue || appState.users[0]?.id || "";
  dom.issueKeyUserInput.innerHTML = appState.users
    .map((item) => `<option value="${item.id}">${item.displayName} · ${item.email}</option>`)
    .join("");
  if (nextValue) {
    dom.issueKeyUserInput.value = nextValue;
  }
}

export function renderIssuedKeyResult(result) {
  const plainTextKey = result.plainTextKey;
  const record = result.record;
  const baseUrl = window.location.origin;
  const endpoint = endpointForProtocol(record.protocol);
  const bindingText = keyBindingLabel(record);
  const snippets = buildIntegrationSnippets(record.protocol, plainTextKey, baseUrl);
  const note = record.protocol === "anthropic"
    ? `Claude Code: try ANTHROPIC_BASE_URL=${baseUrl} and ANTHROPIC_AUTH_TOKEN=${plainTextKey}`
    : "OpenAI-compatible clients should call the chat completions endpoint with this key.";

  dom.issueKeyOutput.innerHTML = `
    <div class="issued-key-card">
      <div class="record-head">
        <strong>${record.name}</strong>
        <span class="tag">${record.protocol}</span>
      </div>
      <p class="muted">The plaintext key is only shown once. Copy it now.</p>
      <div class="issued-key-secret">${plainTextKey}</div>
      <div class="record-meta">
        <button class="secondary compact-button" type="button" data-copy-issued-key="${plainTextKey}">Copy Key</button>
        <button class="ghost compact-button" type="button" data-copy-base-url="${baseUrl}">Copy Base URL</button>
        <button class="ghost compact-button" type="button" data-copy-endpoint="${endpoint}">Copy Endpoint</button>
      </div>
      <div class="summary-row"><span>Base URL</span><strong>${baseUrl}</strong></div>
      <div class="summary-row"><span>Endpoint</span><strong>${endpoint}</strong></div>
      <div class="summary-row"><span>Auth Header</span><strong>${apiKeyHeaderExample(record.protocol, plainTextKey)}</strong></div>
      <div class="summary-row"><span>Route</span><strong>${bindingText}</strong></div>
      <p class="muted">${note}</p>
      <div class="integration-guide">
        ${snippets.map((snippet, index) => `
          <section class="integration-card">
            <div class="snippet-head">
              <div>
                <strong>${snippet.title}</strong>
                <p class="muted">${snippet.note}</p>
              </div>
              <button
                class="ghost compact-button"
                type="button"
                data-copy-snippet-target="issue-snippet-${index}"
                data-copy-label="${snippet.title}"
              >
                Copy Snippet
              </button>
            </div>
            <pre id="issue-snippet-${index}" class="integration-snippet">${snippet.body}</pre>
          </section>
        `).join("")}
      </div>
    </div>
  `;
  translateTree(dom.issueKeyOutput);
}

export function setPageTitle(viewName) {
  const titles = {
    dashboard: t("dashboard_title"),
    upstreams: t("route_management"),
    "create-upstream": t("create_route"),
    users: t("users_quotas"),
    "create-user": getLanguage() === "en" ? "Create User" : "新增用户",
    keys: t("access_keys"),
    "create-key": t("create_key"),
    audit: t("audit_logs"),
    portal: t("portal")
  };
  const title = titles[viewName] ?? "Agent Proxy";
  dom.pageTitle.textContent = title;
  dom.breadcrumbCurrent.textContent = title;
}

export function syncLanguageButtons() {
  const language = getLanguage();
  dom.langZhButton.classList.toggle("is-active", language === "zh");
  dom.langEnButton.classList.toggle("is-active", language === "en");
}

export function activateView(viewName) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  setPageTitle(viewName);

  if (viewName === "audit") {
    if (appState.user?.role !== "admin") {
      setAuditEmptyState(zhEn("请先登录管理员后查看审计日志。", "Sign in as an admin to inspect audit logs."));
    } else if (appState.selectedRequestId) {
      showRequestDetail(appState.selectedRequestId, "admin").catch(showError);
    } else {
      setAuditEmptyState();
    }
  }
}

export function openModal() {
  dom.authModal.classList.add("is-open");
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

  if (!isAdmin && ["upstreams", "create-upstream", "users", "create-user", "keys", "create-key", "audit"].includes(activeView())) {
    activateView(appState.user ? "portal" : "dashboard");
  }
}

export function setSession(session) {
  persistSession(session);
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
  translateTree(document.body);
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
    <div class="detail-card">
      <div class="summary-row"><span>Email</span><strong>${user.email}</strong></div>
      <div class="summary-row"><span>Role</span><strong>${user.role}</strong></div>
      <div class="summary-row"><span>Status</span><strong>${user.isActive ? "Enabled" : "Disabled"}</strong></div>
      <div class="summary-row"><span>Quota</span><strong>${user.quota.mode === "unlimited" ? "Unlimited" : `Left: ${user.quota.remainingTokens}`}</strong></div>
    </div>
  `;
  dom.userActionOutput.textContent = zhEn(`当前已选择用户：${user.displayName}`, `Selected user: ${user.displayName}`);
  dom.toggleUserButton.textContent = user.isActive ? zhEn("禁用当前用户", "Disable User") : zhEn("启用当前用户", "Enable User");
  translateTree(dom.userDetailCard);
}

export function fillUpstreamForm(upstream) {
  appState.selectedUpstreamId = upstream.id;
  renderUpstreamDetailCard(upstream);
  dom.upstreamDetailOutput.textContent = zhEn(`当前已选择上游：${upstream.name}`, `Selected route: ${upstream.name}`);
}

export function resetUpstreamForm() {
  appState.selectedUpstreamId = null;
  dom.upstreamForm.reset();
  dom.upstreamPriorityInput.value = 100;
  dom.upstreamEditorTitle.textContent = zhEn("创建新路由", "Create New Upstream");
  dom.upstreamSubmitButton.textContent = zhEn("保存路由", "Save Route");
  dom.upstreamFormOutput.textContent = zhEn("等待提交", "Waiting for submission");
  setUpstreamAlert("");
}

export function populateUpstreamEditor(upstream) {
  appState.selectedUpstreamId = upstream.id;
  dom.upstreamNameInput.value = upstream.name;
  dom.upstreamBaseUrlInput.value = upstream.baseUrl;
  dom.upstreamApiKeyInput.value = "";
  dom.upstreamDefaultModelInput.value = upstream.defaultModel;
  dom.upstreamPriorityInput.value = upstream.priority;
  dom.upstreamProtocolInput.value = "openai";
  dom.upstreamMappingDefaultInput.value = upstream.defaultModel;
  dom.upstreamEditorTitle.textContent = zhEn(`编辑 ${upstream.name}`, `Edit ${upstream.name}`);
  dom.upstreamSubmitButton.textContent = zhEn("更新路由配置", "Update Route");
  showJson(dom.upstreamFormOutput, stripUpstreamProvider(upstream));
}

export function renderAuditDetail(detail) {
  const request = detail?.request ?? {};
  const usage = detail?.usage ?? null;
  const timeline = Array.isArray(detail?.timeline) ? detail.timeline : [];

  dom.auditDetailTitle.textContent = `${displayText(request.requestedModel)} -> ${displayText(request.mappedModel)}`;
  dom.auditDetail.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "audit-summary";
  appendSummaryRow(summary, zhEn("协议", "Protocol"), displayText(request.protocol));
  appendSummaryRow(summary, zhEn("状态", "Status"), displayText(request.status));
  appendSummaryRow(summary, zhEn("耗时", "Latency"), formatLatency(request.latencyMs));
  appendSummaryRow(summary, zhEn("用量", "Usage"), formatUsageTotal(usage));
  appendSummaryRow(summary, zhEn("创建时间", "Created"), formatDate(request.createdAt));

  const timelineNode = document.createElement("div");
  timelineNode.className = "timeline";

  if (timeline.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = zhEn("暂无审计事件。", "No audit events.");
    timelineNode.appendChild(empty);
  } else {
    timeline.forEach((event) => {
      timelineNode.appendChild(buildTimelineItem(event));
    });
  }

  dom.auditDetail.append(summary, timelineNode);
}

export async function showRequestDetail(requestId, scope = "admin") {
  const detail = await api(scope === "admin" ? `/admin/requests/${requestId}` : `/me/requests/${requestId}`);
  appState.selectedRequestId = requestId;
  syncSelectedRequestList(requestId);
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

function renderUpstreamDetailCard(upstream) {
  if (!upstream) {
    dom.upstreamDetailTitle.textContent = zhEn("选择一条路由", "Select an Upstream");
    dom.upstreamDetailCard.innerHTML = '<p class="empty">从左侧选择一条上游路由后，这里会显示它的详情和管理动作。</p>';
    dom.upstreamToggleButton.textContent = zhEn("切换状态", "Toggle Status");
    dom.upstreamDetailOutput.textContent = zhEn("请先从左侧选择一条路由", "Select an upstream first");
    translateTree(dom.upstreamDetailCard);
    return;
  }

  dom.upstreamDetailTitle.textContent = upstream.name;
  dom.upstreamDetailCard.innerHTML = `
    <div class="detail-card">
      <div class="summary-row"><span>Base URL</span><strong>${upstream.baseUrl}</strong></div>
      <div class="summary-row"><span>Default Model</span><strong>${upstream.defaultModel}</strong></div>
      <div class="summary-row"><span>Priority</span><strong>${upstream.priority}</strong></div>
      <div class="summary-row"><span>Status</span><strong>${upstream.isActive ? "Active" : "Disabled"}</strong></div>
      <div class="summary-row"><span>Created</span><strong>${formatDate(upstream.createdAt)}</strong></div>
    </div>
  `;
  dom.upstreamToggleButton.textContent = upstream.isActive ? zhEn("停用当前路由", "Disable Route") : zhEn("启用当前路由", "Enable Route");
  translateTree(dom.upstreamDetailCard);
}

function renderApiKeyDetailCard(record) {
  if (!record) {
    dom.keyDetailTitle.textContent = zhEn("选择一把访问密钥", "Select an Access Key");
    dom.keyDetailCard.innerHTML = '<p class="empty">从左侧选择一把 access key 后，这里会显示它的协议、endpoint、绑定路由和使用说明。</p>';
    return;
  }

  dom.keyDetailTitle.textContent = record.name;
  const baseUrl = window.location.origin;
  const endpoint = endpointForProtocol(record.protocol);
  const plainTextBlock = record.plainTextKey
    ? `
      <div class="issued-key-secret">${record.plainTextKey}</div>
      <div class="record-meta">
        <button class="secondary compact-button" type="button" data-copy-value="${record.plainTextKey}" data-copied-label="Key Copied">Copy Key</button>
        <button class="ghost compact-button" type="button" data-copy-value="${baseUrl}" data-copied-label="Base URL Copied">Copy Base URL</button>
        <button class="ghost compact-button" type="button" data-copy-value="${endpoint}" data-copied-label="Endpoint Copied">Copy Endpoint</button>
      </div>
    `
    : '<p class="muted">Legacy key: plaintext value is not recoverable. Create a new key if you need to copy it again.</p>';
  const snippets = record.plainTextKey ? buildIntegrationSnippets(record.protocol, record.plainTextKey, baseUrl) : [];

  dom.keyDetailCard.innerHTML = `
    <div class="issued-key-card">
      <div class="record-head">
        <strong>${record.name}</strong>
        <span class="tag">${record.protocol}</span>
      </div>
      ${plainTextBlock}
      <div class="summary-row"><span>Owner</span><strong>${record.userDisplayName || record.userEmail || record.userId}</strong></div>
      <div class="summary-row"><span>Base URL</span><strong>${baseUrl}</strong></div>
      <div class="summary-row"><span>Endpoint</span><strong>${endpoint}</strong></div>
      <div class="summary-row"><span>Route</span><strong>${keyBindingLabel(record)}</strong></div>
      <div class="summary-row"><span>Status</span><strong>${record.isActive ? "Active" : "Revoked"}</strong></div>
      <div class="key-binding-editor">
        <select id="detail-key-binding-select" ${!record.isActive ? "disabled" : ""}>
          ${routeBindingOptionsMarkup(record.upstreamAccountId ?? "")}
        </select>
        <button class="secondary compact-button" type="button" id="detail-save-key-binding" ${!record.isActive ? "disabled" : ""}>Save Route</button>
      </div>
      <div class="record-meta">
        <button class="danger compact-button" type="button" id="detail-delete-key">Delete Key</button>
      </div>
      ${record.plainTextKey ? `
        <div class="integration-guide">
          ${snippets.map((snippet, index) => `
            <section class="integration-card">
              <div class="snippet-head">
                <div>
                  <strong>${snippet.title}</strong>
                  <p class="muted">${snippet.note}</p>
                </div>
                <button class="ghost compact-button" type="button" data-copy-snippet-target="key-detail-snippet-${index}" data-copy-label="${snippet.title}">Copy Snippet</button>
              </div>
              <pre id="key-detail-snippet-${index}" class="integration-snippet">${snippet.body}</pre>
            </section>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
  bindApiKeyCopyButtons(dom.keyDetailCard);
  bindSnippetCopyButtons(dom.keyDetailCard);
  translateTree(dom.keyDetailCard);
}

function bindAllKeyButtons(refreshAdmin, refreshUser) {
  document.querySelectorAll("[data-revoke-all-key-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        const userId = button.dataset.revokeAllKeyUserid;
        const keyId = button.dataset.revokeAllKeyId;
        await api(`/admin/users/${userId}/api-keys/${keyId}`, {
          method: "DELETE"
        });
        await Promise.all([refreshAdmin(), refreshUser()]);
      } catch (error) {
        dom.keyDetailCard.innerHTML = `<p class="empty">${error instanceof Error ? error.message : String(error)}</p>`;
      }
    });
  });

  document.querySelectorAll("[data-key-id]").forEach((card) => {
    card.addEventListener("click", () => {
      appState.selectedApiKeyId = card.dataset.keyId;
      renderApiKeyDetailCard(selectedApiKey());
      bindApiKeyDetailActions(refreshAdmin, refreshUser);
    });
  });
}

function bindApiKeyDetailActions(refreshAdmin, refreshUser) {
  document.querySelector("#detail-save-key-binding")?.addEventListener("click", async () => {
    const record = selectedApiKey();
    if (!record) {
      return;
    }
    try {
      const select = document.querySelector("#detail-key-binding-select");
      await api(`/admin/users/${record.userId}/api-keys/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          upstreamAccountId: select?.value || null
        })
      });
      await Promise.all([refreshAdmin(), refreshUser()]);
    } catch (error) {
      dom.keyDetailCard.innerHTML = `<p class="empty">${error instanceof Error ? error.message : String(error)}</p>`;
    }
  });

  document.querySelector("#detail-delete-key")?.addEventListener("click", async () => {
    const record = selectedApiKey();
    if (!record) {
      return;
    }
    try {
      await api(`/admin/users/${record.userId}/api-keys/${record.id}/permanent`, {
        method: "DELETE"
      });
      appState.selectedApiKeyId = null;
      await Promise.all([refreshAdmin(), refreshUser()]);
    } catch (error) {
      dom.keyDetailCard.innerHTML = `<p class="empty">${error instanceof Error ? error.message : String(error)}</p>`;
    }
  });
}

function renderUpstreamShelf(upstreamData) {
  if (upstreamData.length === 0) {
    dom.upstreams.innerHTML = `
      <article class="empty-state-card">
        <strong>还没有任何路由</strong>
        <p class="muted">右侧填写 Base URL、上游 Key、默认模型和协议后，保存第一条上游路由。</p>
        <button id="create-first-upstream" class="secondary" type="button">去创建第一条路由</button>
      </article>
    `;
    document.querySelector("#create-first-upstream")?.addEventListener("click", () => {
      resetUpstreamForm();
      activateView("create-upstream");
      dom.upstreamForm.scrollIntoView({ behavior: "smooth", block: "start" });
      dom.upstreamNameInput.focus();
    });
    return;
  }

  renderList(dom.upstreams, filteredUpstreams(), (item) => `
    <button class="item-card ${item.id === appState.selectedUpstreamId ? "selected" : ""}" data-upstream-id="${item.id}">
      <div class="record-head">
        <strong>${item.name}</strong>
      </div>
      <p>${item.baseUrl}</p>
      <div class="record-meta">
        <span class="tag">Priority ${item.priority}</span>
        <span class="tag">${item.defaultModel}</span>
        <span class="tag ${item.isActive ? "good" : "warn"}">${item.isActive ? "Active" : "Disabled"}</span>
      </div>
    </button>
  `, appState.upstreamTab === "active" ? "暂无启用中的上游。" : "暂无上游配置。");
  bindUpstreamButtons();
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

export async function refreshAllApiKeys(refreshAdmin, refreshUser) {
  if (appState.user?.role !== "admin") {
    renderList(dom.allApiKeys, [], () => "", "请登录管理员以查看所有密钥。");
    renderApiKeyDetailCard(null);
    return;
  }
  const keys = await api("/admin/api-keys");
  appState.allApiKeys = keys;
  if (!appState.selectedApiKeyId || !keys.some((item) => item.id === appState.selectedApiKeyId)) {
    appState.selectedApiKeyId = keys[0]?.id ?? null;
  }
  renderList(dom.allApiKeys, keys, (item) => `
    <div class="item-card compact ${item.id === appState.selectedApiKeyId ? "selected" : ""}" data-key-id="${item.id}" data-key-userId="${item.userId}" style="cursor: pointer;">
      <div class="record-head">
        <strong>${item.name}</strong>
        <span class="tag">${item.protocol}</span>
      </div>
      <p class="muted">${item.prefix}****** (User: ${item.userDisplayName || item.userEmail})</p>
      <div class="record-meta">
        <span class="tag">${item.protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions"}</span>
        <span class="tag">${keyBindingLabel(item)}</span>
        <span class="tag ${item.isActive ? "good" : "warn"}">${item.isActive ? "Active" : "Revoked"}</span>
        ${item.plainTextKey ? `<button class="ghost compact-button" data-copy-value="${item.plainTextKey}" data-copied-label="Key Copied">Copy Key</button>` : `<span class="tag warn">Legacy Key</span>`}
        <button class="ghost compact-button" data-revoke-all-key-userId="${item.userId}" data-revoke-all-key-id="${item.id}" style="padding: 4px 10px; height: 26px; font-size: 0.7rem;">Revoke</button>
      </div>
    </div>
  `, "系统内暂无 API Key。");
  bindApiKeyCopyButtons(dom.allApiKeys);
  renderApiKeyDetailCard(selectedApiKey());
  bindAllKeyButtons(refreshAdmin, refreshUser);
  bindApiKeyDetailActions(refreshAdmin, refreshUser);
}

export async function refreshAdmin(refreshUser) {
  if (appState.user?.role !== "admin") {
    dom.metrics.innerHTML = [
      cardMetric("登录状态", "需要管理员", "登录后可查看上游、用户、配额和审计信息。", "peach"),
      cardMetric("当前模式", appState.user?.role ?? "访客", "管理员模块会在登录后解锁。", "mint"),
      cardMetric("操作区", "未启用", "右侧配置面板需要管理员权限。", "sky"),
      cardMetric("审计区", "未启用", "请求详情只有管理员可见。", "lilac")
    ].join("");
    renderList(dom.providerHealth, [], () => "", zhEn("请先登录管理员。", "Sign in as an admin first."));
    renderList(dom.recentRequests, [], () => "", zhEn("请先登录管理员。", "Sign in as an admin first."));
    renderList(dom.upstreams, [], () => "", zhEn("请先登录管理员。", "Sign in as an admin first."));
    renderList(dom.users, [], () => "", zhEn("请先登录管理员。", "Sign in as an admin first."));
    renderList(dom.allApiKeys, [], () => "", zhEn("请先登录管理员。", "Sign in as an admin first."));
    renderList(dom.requestList, [], () => "", zhEn("请先登录管理员。", "Sign in as an admin first."));
    dom.upstreamCount.textContent = "0";
    dom.activeUpstreamCount.textContent = "0";
    dom.userCount.textContent = "0";
    dom.quotaUserCount.textContent = "0";
    appState.allApiKeys = [];
    appState.selectedApiKeyId = null;
    appState.selectedUpstreamId = null;
    syncIssueKeyUserOptions();
    renderApiKeyDetailCard(null);
    renderUpstreamDetailCard(null);
    setAuditEmptyState(zhEn("请先登录管理员后查看审计日志。", "Sign in as an admin to inspect audit logs."));
    setUpstreamAlert(activeView() === "upstreams" ? zhEn("请先切换到管理员身份。", "Switch to an admin account first.") : "");
    return;
  }

  const dashboard = await api("/admin/dashboard");
  const upstreamData = await api("/admin/upstreams");
  const usersData = await api("/admin/users");
  const requests = await api("/admin/requests");

  appState.users = usersData;
  appState.upstreams = upstreamData;
  if (!appState.selectedUpstreamId || !upstreamData.some((item) => item.id === appState.selectedUpstreamId)) {
    appState.selectedUpstreamId = upstreamData[0]?.id ?? null;
  }
  syncIssueKeyUpstreamOptions();
  syncIssueKeyUserOptions();
  setUpstreamAlert(upstreamData.length === 0 && activeView() === "upstreams" ? zhEn("当前还没有任何路由，请先创建第一条上游路由。", "No routes yet. Create your first upstream route.") : "");
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
    <div class="item-card">
      <div class="record-head">
        <strong>${item.name}</strong>
        <span class="tag ${item.status === "healthy" ? "good" : "warn"}">${item.status}</span>
      </div>
      <div class="record-meta">
        <span class="tag">Avg Latency</span>
        <span class="tag">${item.avgLatencyMs} ms</span>
      </div>
    </div>
  `, "暂无上游健康数据。");

  renderList(dom.recentRequests, dashboard.recentRequests, requestSummaryMarkup, "暂无请求。");
  bindRequestButtons("admin");

  renderUpstreamShelf(upstreamData);
  renderUpstreamDetailCard(upstreamData.find((item) => item.id === appState.selectedUpstreamId) ?? null);

  renderList(dom.users, usersData, (item) => `
    <button class="item-card ${item.id === appState.selectedUserId ? "selected" : ""}" data-user-id="${item.id}">
      <div class="record-head">
        <strong>${item.displayName}</strong>
        <span class="tag">${item.role}</span>
      </div>
      <p>${item.email}</p>
      <div class="record-meta">
        <span class="tag ${item.isActive ? "good" : "warn"}">${item.isActive ? "Active" : "Disabled"}</span>
        <span class="tag">${item.quota.mode === "unlimited" ? "Unlimited" : `Left: ${item.quota.remainingTokens}`}</span>
      </div>
    </button>
  `, "暂无用户。");
  bindUserButtons();
  await refreshAllApiKeys(() => refreshAdmin(refreshUser), refreshUser);

  if (!requests.some((item) => item.id === appState.selectedRequestId)) {
    appState.selectedRequestId = requests[0]?.id ?? null;
  }

  renderList(dom.requestList, requests, (item) => requestSummaryMarkup({
    ...item,
    isSelected: item.id === appState.selectedRequestId
  }), "暂无可审计请求。");
  bindRequestButtons("admin");

  if (!appState.selectedRequestId) {
    setAuditEmptyState(zhEn("当前还没有可审计的请求记录。", "No auditable requests yet."));
  } else if (activeView() === "audit") {
    await showRequestDetail(appState.selectedRequestId, "admin");
  }

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
    <div class="item-card">
      <div class="record-head">
        <strong>${item.name}</strong>
        <span class="tag">${item.protocol}</span>
      </div>
      <p class="muted">${item.prefix}******</p>
      <div class="record-meta">
        <span class="tag">${item.protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions"}</span>
        <span class="tag">${keyBindingLabel(item)}</span>
        <span class="tag">${formatDate(item.createdAt)}</span>
        <span class="tag ${item.isActive ? "good" : "warn"}">${item.isActive ? "Active" : "Revoked"}</span>
        ${item.plainTextKey ? `<button class="ghost compact-button" data-copy-value="${item.plainTextKey}" data-copied-label="Key Copied">Copy Key</button>` : `<span class="tag warn">Legacy Key</span>`}
      </div>
    </div>
  `, "暂无 API Key。");
  bindApiKeyCopyButtons(dom.meKeys);

  renderList(dom.meUsage, usage.entries, (item) => `
    <button class="item-card" data-request-id="${item.requestId}">
      <div class="record-head">
        <strong>Request ${item.requestId.replace(/^req_/, "").slice(0, 8)}</strong>
        <span class="tag">${item.inputTokens + item.outputTokens} tok</span>
      </div>
      <p class="muted">Est. $${item.estimatedCostUsd.toFixed(4)}</p>
      <div class="record-meta">
        <span class="tag">${formatTime(item.createdAt)}</span>
        <span class="tag">Out: ${item.outputTokens}</span>
      </div>
    </button>
  `, "暂无用量记录。");
  bindRequestButtons("me");
}
