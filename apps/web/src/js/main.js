import { api } from "./api.js";
import { dom } from "./dom.js";
import { activeView, appState, selectedUpstream, selectedUser } from "./state.js";
import {
  activateView,
  closeModal,
  fillQuotaForm,
  openModal,
  refreshAdmin,
  refreshHealth,
  refreshUser,
  resetUpstreamForm,
  setPageTitle,
  setSession,
  setUpstreamAlert,
  setUpstreamTab,
  showError
} from "./renderers.js";
import { showJson } from "./utils.js";

async function login(email, password) {
  const session = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: {}
  });
  setSession(session);
  await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.classList.contains("is-disabled")) {
        return;
      }
      activateView(button.dataset.view);
    });
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
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
  dom.dashboardRefreshButton.addEventListener("click", async () => {
    await Promise.all([refreshHealth(), refreshAdmin(refreshUser), refreshUser()]);
  });

  dom.heroUpstreamFocus.addEventListener("click", () => {
    activateView("upstreams");
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

  document.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => {
      openModal({
        email: button.dataset.email,
        password: button.dataset.password
      });
    });
  });

  dom.authModal.addEventListener("click", (event) => {
    if (event.target === dom.authModal) {
      closeModal();
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
      showJson(dom.upstreamFormOutput, result);
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
      dom.upstreamFormOutput.textContent = "请先从左侧选择一个上游。";
      return;
    }
    try {
      const result = await api(`/admin/upstreams/${upstream.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !upstream.isActive })
      });
      showJson(dom.upstreamFormOutput, result);
      setUpstreamAlert("");
      await refreshAdmin(refreshUser);
    } catch (error) {
      dom.upstreamFormOutput.textContent = error instanceof Error ? error.message : String(error);
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
    if (!appState.selectedUserId) {
      dom.issueKeyOutput.textContent = "请先选择一个用户。";
      return;
    }
    try {
      const payload = {
        name: dom.issueKeyNameInput.value || `${dom.issueKeyProtocolInput.value} key`,
        protocol: dom.issueKeyProtocolInput.value
      };
      const result = await api(`/admin/users/${appState.selectedUserId}/api-keys`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      showJson(dom.issueKeyOutput, result);
      dom.issueKeyForm.reset();
      await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
    } catch (error) {
      dom.issueKeyOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  dom.deleteUserButton.addEventListener("click", async () => {
    const user = selectedUser();
    if (!user) {
      dom.issueKeyOutput.textContent = "请先选择一个用户。";
      return;
    }
    if (user.role === "admin") {
      dom.issueKeyOutput.textContent = "不能删除管理员账号。";
      return;
    }
    try {
      const result = await api(`/admin/users/${user.id}`, {
        method: "DELETE"
      });
      showJson(dom.issueKeyOutput, result);
      appState.selectedUserId = null;
      dom.userActionTitle.textContent = "未选择用户";
      dom.userDetailCard.innerHTML = '<p class="empty">从左侧选择用户后，这里会显示该用户的状态、额度和密钥操作。</p>';
      dom.quotaPanelTitle.textContent = "请选择一个用户";
      dom.quotaFormOutput.textContent = "先从左侧选择一个用户";
      await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
    } catch (error) {
      dom.issueKeyOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  dom.toggleUserButton.addEventListener("click", async () => {
    const user = selectedUser();
    if (!user) {
      dom.issueKeyOutput.textContent = "请先选择一个用户。";
      return;
    }
    if (user.role === "admin") {
      dom.issueKeyOutput.textContent = "不能修改管理员账号状态。";
      return;
    }
    try {
      const result = await api(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive })
      });
      showJson(dom.issueKeyOutput, result);
      await Promise.all([refreshAdmin(refreshUser), refreshUser()]);
    } catch (error) {
      dom.issueKeyOutput.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

export function initApp() {
  bindNavigation();
  bindToolbar();
  bindForms();
  setSession(null);
  setPageTitle("dashboard");
  refreshHealth();
  refreshAdmin(refreshUser);
  refreshUser();
}
