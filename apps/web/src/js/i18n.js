const STORAGE_KEY = "agent-proxy-language";
const listeners = new Set();

const textPairs = [
  ["系统总览", "Dashboard"],
  ["System dashboard", "System dashboard"],
  ["路由管理", "Route Management"],
  ["上游路由配置", "Upstream routing"],
  ["新增路由", "Create Route"],
  ["创建上游路由", "Create upstream route"],
  ["成员配额", "Users & Quotas"],
  ["User quota", "User quota"],
  ["新增用户", "Create User"],
  ["Create user", "Create user"],
  ["访问密钥", "Access Keys"],
  ["访问密钥管理", "Access key management"],
  ["新增密钥", "Create Key"],
  ["创建访问密钥", "Create access key"],
  ["审计日志", "Audit Logs"],
  ["Security traces", "Security traces"],
  ["个人工作台", "Portal"],
  ["My workspace", "My workspace"],
  ["Workspace /", "Workspace /"],
  ["登录配置", "Sign In"],
  ["退出登录", "Sign Out"],
  ["路由详情", "Route Details"],
  ["选择一条路由", "Select an upstream"],
  ["编辑当前路由", "Edit Route"],
  ["切换状态", "Toggle Status"],
  ["请先从左侧选择一条路由", "Select an upstream first"],
  ["路由健康", "Route Health"],
  ["健康检查", "Health Check"],
  ["+ 新增路由", "+ Create Route"],
  ["创建新路由", "Create New Route"],
  ["名称", "Name"],
  ["主路由", "Main route"],
  ["上游密钥", "Upstream Key"],
  ["默认模型", "Default Model"],
  ["优先级", "Priority"],
  ["协议", "Protocol"],
  ["兜底映射", "Fallback Mapping"],
  ["保存路由", "Save Route"],
  ["清空表单", "Clear Form"],
  ["保存结果", "Save Result"],
  ["提交后查看", "Review After Save"],
  ["等待提交", "Waiting for submission"],
  ["创建新用户", "Create New User"],
  ["创建用户", "Create User"],
  ["创建结果", "Result"],
  ["User Directory", "User Directory"],
  ["Manage App Users", "Manage App Users"],
  ["Onboard", "Onboard"],
  ["Register User", "Register User"],
  ["Quota Policies", "Quota Policies"],
  ["Select an Account", "Select an Account"],
  ["Mode", "Mode"],
  ["Monthly Tokens", "Monthly Tokens"],
  ["Remaining Tokens", "Remaining Tokens"],
  ["Save Policy", "Save Policy"],
  ["Select an account first", "Select an account first"],
  ["Account Actions", "Account Actions"],
  ["No Account Selected", "No Account Selected"],
  ["Disable Account", "Disable Account"],
  ["Delete Account", "Delete Account"],
  ["System Keys", "System Keys"],
  ["Global API Keys", "Global API Keys"],
  ["Key Details", "Key Details"],
  ["Select an Access Key", "Select an Access Key"],
  ["+ CREATE ACCESS KEY", "+ Create Access Key"],
  ["Issue New Access Key", "Issue New Access Key"],
  ["Account", "Account"],
  ["Key Descriptor", "Key Descriptor"],
  ["API Key", "API Key"],
  ["Route Binding", "Route Binding"],
  ["Auto Select By Protocol And Priority", "Auto Select By Protocol And Priority"],
  ["Generate Key", "Generate Key"],
  ["Key Result", "Key Result"],
  ["Create And Copy", "Create And Copy"],
  ["Create a new access key to see its plaintext value, endpoint, and integration snippets.", "Create a new access key to see its plaintext value, endpoint, and integration snippets."],
  ["Audit Log", "Audit Log"],
  ["System Traces", "System Traces"],
  ["Inspector", "Inspector"],
  ["Select a Trace", "Select a Trace"],
  ["Auth Keys", "Auth Keys"],
  ["My Portal Keys", "My Portal Keys"],
  ["Billing", "Billing"],
  ["Traffic Consumption", "Traffic Consumption"],
  ["System Access", "System Access"],
  ["Login Workbench", "Login Workbench"],
  ["Secure Login", "Secure Login"],
  ["Session Required.", "Session Required."],
  ["Refresh", "Refresh"],
  ["All Keys", "All Keys"],
  ["Active", "Active"],
  ["Granted", "Granted"],
  ["Quota Restricted", "Quota Restricted"],
  ["登录", "Sign In"],
  ["切换身份", "Switch Account"],
  ["未登录", "Not signed in"],
  ["当前已选择用户：", "Selected user: "],
  ["当前已选择上游：", "Selected route: "],
  ["请先选择一个用户。", "Select a user first."],
  ["不能删除管理员账号。", "Admin accounts cannot be deleted."],
  ["不能修改管理员账号状态。", "Admin account status cannot be changed."],
  ["请先从左侧选择一个上游。", "Select an upstream from the list first."],
  ["还没有任何路由", "No routes yet"],
  ["去创建第一条路由", "Create the first route"],
  ["当前还没有任何路由，请先创建第一条上游路由。", "No routes yet. Create your first upstream route."],
  ["请先切换到管理员身份。", "Switch to an admin account first."],
  ["请先登录管理员。", "Sign in as an admin first."],
  ["柔软运行中", "Healthy"],
  ["异常", "Degraded"],
  ["不可用", "Unavailable"],
  ["无法连接到服务", "Cannot reach the service"],
  ["当前还没有会话", "No active session"],
  ["为 ", "Configure quota for "],
  [" 的账户动作", " account actions"],
  ["Status", "Status"],
  ["Enabled", "Enabled"],
  ["Disabled", "Disabled"],
  ["Quota", "Quota"],
  ["Unlimited", "Unlimited"],
  ["Left:", "Left:"],
  ["Base URL", "Base URL"],
  ["Created", "Created"],
  ["Route", "Route"],
  ["Owner", "Owner"],
  ["Legacy key: plaintext value is not recoverable. Create a new key if you need to copy it again.", "Legacy key: plaintext value is not recoverable. Create a new key if you need to copy it again."],
  ["The plaintext key is only shown once. Copy it now.", "The plaintext key is only shown once. Copy it now."],
  ["Copy Key", "Copy Key"],
  ["Copy Base URL", "Copy Base URL"],
  ["Copy Endpoint", "Copy Endpoint"],
  ["Copy Snippet", "Copy Snippet"],
  ["Legacy Key", "Legacy Key"],
  ["Save Route", "Save Route"],
  ["Select an upstream first", "Select an upstream first"],
  ["Select an Access Key", "Select an Access Key"],
  ["Create New Upstream", "Create New Upstream"],
  ["Edit ", "Edit "],
  ["Select an upstream", "Select an upstream"],
  ["Toggle Status", "Toggle Status"],
  ["Disable Upstream", "Disable Route"],
  ["Enable Upstream", "Enable Route"],
  ["保存上游配置", "Save Route"],
  ["更新上游配置", "Update Route"],
  ["等待提交", "Waiting"],
  ["当前已选择用户：", "Selected user: "],
  ["当前已选择上游：", "Selected route: "],
  ["系统总览", "Dashboard"],
  ["新增密钥", "Create Key"],
  ["新增路由", "Create Route"],
  ["访问密钥", "Access Keys"],
  ["路由管理", "Route Management"],
  ["成员配额", "Users & Quotas"],
  ["审计日志", "Audit Logs"],
  ["个人工作台", "Portal"],
  ["Refresh", "Refresh"],
  ["Create Route", "Create Route"],
  ["Create Key", "Create Key"],
  ["Access Keys", "Access Keys"],
  ["Health Check", "Health Check"],
  ["Save Result", "Save Result"],
  ["Review After Save", "Review After Save"],
  ["Waiting", "Waiting"],
  ["Signed in", "Signed in"],
  ["soft idle", "soft idle"],
  ["中文", "中文"],
  ["English", "English"]
];

const uiCopy = {
  zh: {
    app_title: "Agent Proxy",
    dashboard_title: "系统总览",
    route_management: "路由管理",
    create_route: "新增路由",
    users_quotas: "成员配额",
    access_keys: "访问密钥",
    create_key: "新增密钥",
    audit_logs: "审计日志",
    portal: "个人工作台",
    lang_zh: "中文",
    lang_en: "English"
  },
  en: {
    app_title: "Agent Proxy",
    dashboard_title: "Dashboard",
    route_management: "Route Management",
    create_route: "Create Route",
    users_quotas: "Users & Quotas",
    access_keys: "Access Keys",
    create_key: "Create Key",
    audit_logs: "Audit Logs",
    portal: "Portal",
    lang_zh: "中文",
    lang_en: "English"
  }
};

function normalizeLanguage(input) {
  return input === "en" ? "en" : "zh";
}

let currentLanguage = normalizeLanguage(
  (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY))
    || (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en") ? "en" : "zh")
);

function replaceExactText(text, lang) {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }
  const pair = textPairs.find(([zh, en]) => zh === trimmed || en === trimmed);
  if (!pair) {
    return text;
  }
  const replacement = lang === "en" ? pair[1] : pair[0];
  return text.replace(trimmed, replacement);
}

function walkTextNodes(root, lang) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement) {
        return NodeFilter.FILTER_REJECT;
      }
      const tagName = node.parentElement.tagName;
      if (tagName === "SCRIPT" || tagName === "STYLE") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((node) => {
    node.textContent = replaceExactText(node.textContent, lang);
  });
}

function translateAttributes(root, lang) {
  root.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((element) => {
    element.placeholder = replaceExactText(element.placeholder, lang);
  });
}

export function translateTree(root = document.body) {
  if (!root) {
    return;
  }
  walkTextNodes(root, currentLanguage);
  if (root instanceof Element || root instanceof DocumentFragment || root instanceof Document) {
    translateAttributes(root, currentLanguage);
  }
}

export function getLanguage() {
  return currentLanguage;
}

export function getLocale() {
  return currentLanguage === "en" ? "en-US" : "zh-CN";
}

export function t(key) {
  return uiCopy[currentLanguage][key] ?? key;
}

export function setLanguage(lang) {
  const next = normalizeLanguage(lang);
  if (currentLanguage === next) {
    translateTree(document.body);
    return;
  }
  currentLanguage = next;
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next === "en" ? "en" : "zh-CN";
  listeners.forEach((listener) => listener(next));
  translateTree(document.body);
}

export function initI18n() {
  document.documentElement.lang = currentLanguage === "en" ? "en" : "zh-CN";
  translateTree(document.body);
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
