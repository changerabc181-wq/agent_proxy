export const appState = {
  token: "",
  user: null,
  selectedUserId: null,
  selectedApiKeyId: null,
  selectedRequestId: null,
  selectedUpstreamId: null,
  upstreamTab: "all",
  upstreams: [],
  allApiKeys: [],
  userApiKeys: [],
  users: []
};

export function activeView() {
  return document.querySelector(".nav-item.active")?.dataset.view ?? "dashboard";
}

export function selectedUser() {
  return appState.users.find((item) => item.id === appState.selectedUserId) ?? null;
}

export function selectedUpstream() {
  return appState.upstreams.find((item) => item.id === appState.selectedUpstreamId) ?? null;
}

export function selectedApiKey() {
  return appState.allApiKeys.find((item) => item.id === appState.selectedApiKeyId) ?? null;
}

export function filteredUpstreams() {
  switch (appState.upstreamTab) {
    case "active":
      return appState.upstreams.filter((item) => item.isActive);
    default:
      return appState.upstreams;
  }
}
