import { appState } from "./state.js";

export async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers ?? {})
  };

  if (appState.token) {
    headers.authorization = `Bearer ${appState.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

export async function fetchHealth() {
  return fetch("/health").then((response) => response.json());
}
