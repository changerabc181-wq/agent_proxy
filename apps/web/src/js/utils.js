export function formatDate(value) {
  return new Date(value).toLocaleString();
}

export function showJson(node, value) {
  node.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function renderList(target, items, formatter, emptyText = "暂无数据。") {
  target.innerHTML = "";
  if (items.length === 0) {
    target.innerHTML = `<p class="empty">${emptyText}</p>`;
    return;
  }

  items.forEach((item) => {
    const element = document.createElement("article");
    element.className = "list-item";
    element.innerHTML = formatter(item);
    target.appendChild(element);
  });
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
  return `
    <button class="record-button ${item.isSelected ? "selected" : ""}" data-request-id="${item.id}">
      <div class="record-head">
        <span class="tag">${item.protocol}</span>
        <span class="subtle">${item.status ?? ""}</span>
      </div>
      <strong>${item.requestedModel}</strong>
      <p class="muted">映射到 ${item.mappedModel}</p>
      <div class="record-meta">
        <span>${formatDate(item.createdAt)}</span>
        <span>${item.latencyMs ?? 0} ms</span>
      </div>
    </button>
  `;
}
