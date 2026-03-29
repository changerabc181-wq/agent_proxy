import { api } from "./api.js";
import { dom } from "./dom.js";
import { initI18n, onLanguageChange, setLanguage, translateTree } from "./i18n.js";
import { activeView, appState, selectedUpstream, selectedUser } from "./state.js";
import {
  activateView,
  closeModal,
  fillQuotaForm,
  openModal,
  populateUpstreamEditor,
  refreshAdmin,
  refreshHealth,
  refreshUser,
  renderIssuedKeyResult,
  resetUpstreamForm,
  stripUpstreamProvider,
  getStoredSession,
  syncLanguageButtons,
  syncIssueKeyUpstreamOptions,
  setPageTitle,
  setSession,
  setUpstreamAlert,
  setUpstreamTab,
  showError
} from "./renderers.js";
import { showJson } from "./utils.js";

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

async function login(email, password) {
  const session = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: {}
  });
  setSession(session);
  await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
}

async function restoreSession() {
  const storedSession = getStoredSession();
  setSession(storedSession);

  try {
    await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
  } catch (error) {
    const isAuthError = error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message);
    if (!storedSession || !isAuthError) {
      throw error;
    }

    setSession(null);
    await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
    throw new Error("登录已失效，请重新登录");
  }
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.classList.contains("is-disabled")) {
        return;
      }
      if (button.dataset.view === "create-upstream") {
        resetUpstreamForm();
      }
      activateView(button.dataset.view);
    });
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.viewTarget === "create-upstream") {
        resetUpstreamForm();
      }
      activateView(button.dataset.viewTarget);
    });
  });

  dom.upstreamTabs.querySelectorAll("[data-upstream-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setUpstreamTab(button.dataset.upstreamTab);

      if (button.dataset.upstreamTab === "granted") {
        activateView("users");
        dom.userDetailCard.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      if (button.dataset.upstreamTab === "quota") {
        activateView("users");
        dom.quotaForm.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      activateView("upstreams");
      refreshAdmin(refreshUser).catch(showError);
    });
  });
}

function bindToolbar() {
  dom.langZhButton.addEventListener("click", () => setLanguage("zh"));
  dom.langEnButton.addEventListener("click", () => setLanguage("en"));

  dom.dashboardRefreshButton.addEventListener("click", async () => {
    await Promise.all([refreshHealth(), refreshAdmin(refreshUser), refreshUser()]);
  });

  dom.heroUpstreamFocus.addEventListener("click", () => {
    resetUpstreamForm();
    activateView("create-upstream");
    dom.upstreamForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  dom.heroUpstreamReset.addEventListener("click", () => {
    activateView("users");
    dom.quotaForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  dom.openAuthButton.addEventListener("click", () => openModal());
  dom.closeAuthButton.addEventListener("click", closeModal);
  dom.logoutButton.addEventListener("click", async () => {
    setSession(null);
    await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
  });

  dom.authModal.addEventListener("click", (event) => {
    if (event.target === dom.authModal) {
      closeModal();
    }
  });

  dom.editUpstreamButton.addEventListener("click", () => {
    const upstream = selectedUpstream();
    if (!upstream) {
      dom.upstreamDetailOutput.textContent = "请先从左侧选择一个上游。";
      return;
    }
    populateUpstreamEditor(upstream);
    activateView("create-upstream");
    dom.upstreamForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  dom.issueKeyOutput.addEventListener("click", async (event) => {
    const copyKeyButton = event.target.closest("[data-copy-issued-key]");
    const copyBaseUrlButton = event.target.closest("[data-copy-base-url]");
    const copyEndpointButton = event.target.closest("[data-copy-endpoint]");
    const copySnippetButton = event.target.closest("[data-copy-snippet-target]");
    if (!copyKeyButton && !copyBaseUrlButton && !copyEndpointButton && !copySnippetButton) {
      return;
    }

    try {
      if (copyKeyButton) {
        await copyText(copyKeyButton.dataset.copyIssuedKey);
        const note = dom.issueKeyOutput.querySelector(".muted");
        if (note) {
          note.textContent = "Plaintext key copied.";
        }
        return;
      }

      if (copyBaseUrlButton) {
        await copyText(copyBaseUrlButton.dataset.copyBaseUrl);
        const note = dom.issueKeyOutput.querySelector(".muted");
        if (note) {
          note.textContent = "Base URL copied.";
        }
        return;
      }

      if (copySnippetButton) {
        const target = dom.issueKeyOutput.querySelector(`#${copySnippetButton.dataset.copySnippetTarget}`);
        if (target) {
          await copyText(target.textContent);
          const note = dom.issueKeyOutput.querySelector(".muted");
          if (note) {
            note.textContent = `${copySnippetButton.dataset.copyLabel} snippet copied.`;
          }
        }
        return;
      }

      await copyText(copyEndpointButton.dataset.copyEndpoint);
      const note = dom.issueKeyOutput.querySelector(".muted");
      if (note) {
        note.textContent = "Endpoint copied.";
      }
    } catch (error) {
      dom.issueKeyOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

function bindForms() {
  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(dom.loginForm);
    try {
      await login(form.get("email"), form.get("password"));
    } catch (error) {
      showError(error);
    }
  });

  dom.createUserForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(dom.createUserForm);
    try {
      const result = await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          displayName: form.get("displayName"),
          password: form.get("password")
        })
      });
      showJson(dom.userFormOutput, result);
      await refreshAdmin(refreshUser);
    } catch (error) {
      dom.userFormOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  dom.upstreamForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(dom.upstreamForm);
      const payload = Object.fromEntries(form.entries());
      const isEditing = Boolean(appState.selectedUpstreamId);
      const result = await api(isEditing ? `/admin/upstreams/${appState.selectedUpstreamId}` : "/admin/upstreams", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      showJson(dom.upstreamFormOutput, stripUpstreamProvider(result));
      setUpstreamAlert("");
      if (!isEditing) {
        resetUpstreamForm();
      }
      await refreshAdmin(refreshUser);
    } catch (error) {
      dom.upstreamFormOutput.textContent = error instanceof Error ? error.message : String(error);
      setUpstreamAlert(error instanceof Error ? error.message : String(error));
    }
  });

  dom.upstreamToggleButton.addEventListener("click", async () => {
    const upstream = selectedUpstream();
    if (!upstream) {
      dom.upstreamDetailOutput.textContent = "请先从左侧选择一个上游。";
      return;
    }
    try {
      const result = await api(`/admin/upstreams/${upstream.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !upstream.isActive })
      });
      showJson(dom.upstreamDetailOutput, stripUpstreamProvider(result));
      setUpstreamAlert("");
      await refreshAdmin(refreshUser);
    } catch (error) {
      dom.upstreamDetailOutput.textContent = error instanceof Error ? error.message : String(error);
      setUpstreamAlert(error instanceof Error ? error.message : String(error));
    }
  });

  dom.upstreamResetButton.addEventListener("click", () => {
    resetUpstreamForm();
  });

  dom.quotaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!appState.selectedUserId) {
      dom.quotaFormOutput.textContent = "请先选择一个用户。";
      return;
    }
    try {
      const form = new FormData(dom.quotaForm);
      const payload = {
        mode: form.get("mode"),
        monthlyTokenLimit: form.get("monthlyTokenLimit"),
        remainingTokens: form.get("remainingTokens")
      };
      const result = await api(`/admin/users/${appState.selectedUserId}/quota-policy`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      showJson(dom.quotaFormOutput, result);
      await refreshAdmin(refreshUser);
    } catch (error) {
      dom.quotaFormOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  dom.issueKeyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!dom.issueKeyUserInput.value) {
      dom.issueKeyOutput.textContent = "请先选择一个用户。";
      return;
    }
    try {
      const payload = {
        userId: dom.issueKeyUserInput.value,
        name: dom.issueKeyNameInput.value || `${dom.issueKeyProtocolInput.value} key`,
        protocol: dom.issueKeyProtocolInput.value,
        upstreamAccountId: dom.issueKeyUpstreamInput.value || null
      };
      const result = await api(`/admin/users/${payload.userId}/api-keys`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderIssuedKeyResult(result);
      dom.issueKeyForm.reset();
      syncIssueKeyUpstreamOptions();
      await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
    } catch (error) {
      dom.issueKeyOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  dom.deleteUserButton.addEventListener("click", async () => {
    const user = selectedUser();
    if (!user) {
      dom.userActionOutput.textContent = "请先选择一个用户。";
      return;
    }
    if (user.role === "admin") {
      dom.userActionOutput.textContent = "不能删除管理员账号。";
      return;
    }
    try {
      const result = await api(`/admin/users/${user.id}`, {
        method: "DELETE"
      });
      showJson(dom.userActionOutput, result);
      appState.selectedUserId = null;
      dom.userActionTitle.textContent = "未选择用户";
      dom.userDetailCard.innerHTML = '<p class="empty">从左侧选择用户后，这里会显示该用户的状态、额度和密钥操作。</p>';
      dom.quotaPanelTitle.textContent = "请选择一个用户";
      dom.quotaFormOutput.textContent = "先从左侧选择一个用户";
      await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
    } catch (error) {
      dom.userActionOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  dom.toggleUserButton.addEventListener("click", async () => {
    const user = selectedUser();
    if (!user) {
      dom.userActionOutput.textContent = "请先选择一个用户。";
      return;
    }
    if (user.role === "admin") {
      dom.userActionOutput.textContent = "不能修改管理员账号状态。";
      return;
    }
    try {
      const result = await api(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive })
      });
      showJson(dom.userActionOutput, result);
      await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
    } catch (error) {
      dom.userActionOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

export function initApp() {
  initI18n();
  bindNavigation();
  bindToolbar();
  bindForms();
  setPageTitle("dashboard");
  syncLanguageButtons();
  refreshHealth().catch(showError);
  restoreSession().catch(showError);
  translateTree(document.body);
  onLanguageChange(() => {
    syncLanguageButtons();
    setPageTitle(activeView());
    translateTree(document.body);
    refreshHealth().catch(showError);
    refreshAdmin(refreshUser).catch(showError);
    refreshUser().catch(showError);
  });
}
