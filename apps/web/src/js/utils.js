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
    <button class="item-card ${item.isSelected ? "selected" : ""}" data-request-id="${item.id}">
      <div class="record-head">
        <strong>${item.requestedModel}</strong>
        <span class="tag good">${item.status ?? ""}</span>
      </div>
      <p class="muted">Mapped to ${item.mappedModel}</p>
      <div class="record-meta">
        <span class="tag">${item.protocol}</span>
        <span class="tag">${item.latencyMs ?? 0} ms</span>
        <span class="tag">${formatDate(item.createdAt).split(",")[1]}</span>
      </div>
    </button>
  `;
}
