import { getLocale, translateTree } from "./i18n.js";

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function formatDate(value, options) {
  const date = parseDate(value);
  return date ? date.toLocaleString(getLocale(), options) : "-";
}

export function formatTime(value, options = { hour: "2-digit", minute: "2-digit", second: "2-digit" }) {
  const date = parseDate(value);
  return date ? date.toLocaleTimeString(getLocale(), options) : "-";
}

export function showJson(node, value) {
  node.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function renderList(target, items, formatter, emptyText = "暂无数据。") {
  target.innerHTML = "";
  if (items.length === 0) {
    target.innerHTML = `<p class="empty">${emptyText}</p>`;
    translateTree(target);
    return;
  }

  items.forEach((item) => {
    const element = document.createElement("article");
    element.className = "list-item";
    element.innerHTML = formatter(item);
    target.appendChild(element);
  });
  translateTree(target);
}

export function cardMetric(label, value, detail = "", tone = "") {
  return `
    <article class="metric-card ${tone}">
      <p class="muted">${label}</p>
      <strong>${value}</strong>
      <p class="muted">${detail}</p>
    </article>
  `;
}

export function requestSummaryMarkup(item) {
  const requestedModel = item.requestedModel ?? "Unknown Model";
  const mappedModel = item.mappedModel ?? "Unknown Route";
  const status = item.status ?? "unknown";
  const latency = Number.isFinite(Number(item.latencyMs)) ? `${Number(item.latencyMs)} ms` : "-";

  return `
    <button class="item-card ${item.isSelected ? "selected" : ""}" data-request-id="${item.id}">
      <div class="record-head">
        <strong>${requestedModel}</strong>
        <span class="tag good">${status}</span>
      </div>
      <p class="muted">Mapped to ${mappedModel}</p>
      <div class="record-meta">
        <span class="tag">${item.protocol ?? "-"}</span>
        <span class="tag">${latency}</span>
        <span class="tag">${formatTime(item.createdAt)}</span>
      </div>
    </button>
  `;
}
