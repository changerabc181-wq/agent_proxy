import { createId, estimateCost, estimateTokensFromText, generateApiKey, maskSecret, nowIso, sha256 } from "./utils.mjs";

const adminPassword = "admin123";
const userPassword = "demo123";

function newAuditEvent(requestId, type, payload) {
  return {
    id: createId("evt"),
    requestId,
    type,
    createdAt: nowIso(),
    payload
  };
}

function newProxyRequest({
  userId,
  apiKeyId,
  protocol,
  requestedModel,
  mappedModel,
  upstreamAccountId,
  status,
  latencyMs
}) {
  return {
    id: createId("req"),
    userId,
    apiKeyId,
    protocol,
    requestedModel,
    mappedModel,
    upstreamAccountId,
    status,
    latencyMs,
    createdAt: nowIso()
  };
}

const initialUpstreamId = createId("up");
const secondUpstreamId = createId("up");
const adminId = createId("usr");
const demoUserId = createId("usr");

const anthropicKeyPlain = generateApiKey("anthropic");
const openaiKeyPlain = generateApiKey("openai");

export const state = {
  config: {
    tokenSecret: "agent-proxy-dev-secret"
  },
  users: [
    {
      id: adminId,
      email: "admin@example.com",
      displayName: "Admin Operator",
      role: "admin",
      passwordHash: sha256(adminPassword),
      isActive: true,
      createdAt: nowIso()
    },
    {
      id: demoUserId,
      email: "demo@example.com",
      displayName: "Demo User",
      role: "user",
      passwordHash: sha256(userPassword),
      isActive: true,
      createdAt: nowIso()
    }
  ],
  upstreams: [
    {
      id: initialUpstreamId,
      name: "Primary OpenRouter",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyMasked: "or-sk...demo",
      defaultModel: "glm-5",
      isActive: true,
      priority: 10,
      createdAt: nowIso()
    },
    {
      id: secondUpstreamId,
      name: "Fallback MiniMax",
      provider: "minimax",
      baseUrl: "https://api.minimax.chat/v1",
      apiKeyMasked: "mm-sk...demo",
      defaultModel: "abab7-chat",
      isActive: true,
      priority: 20,
      createdAt: nowIso()
    }
  ],
  mappings: [
    {
      id: createId("map"),
      upstreamAccountId: initialUpstreamId,
      protocol: "anthropic",
      requestedModel: "claude-opus-4-1",
      targetModel: "glm-5",
      isFallback: false
    },
    {
      id: createId("map"),
      upstreamAccountId: initialUpstreamId,
      protocol: "anthropic",
      requestedModel: "*",
      targetModel: "glm-5",
      isFallback: true
    },
    {
      id: createId("map"),
      upstreamAccountId: secondUpstreamId,
      protocol: "openai",
      requestedModel: "*",
      targetModel: "abab7-chat",
      isFallback: true
    }
  ],
  apiKeys: [
    {
      id: createId("key"),
      userId: demoUserId,
      protocol: "anthropic",
      name: "Claude Code",
      prefix: anthropicKeyPlain.slice(0, 12),
      hashedSecret: sha256(anthropicKeyPlain),
      createdAt: nowIso(),
      isActive: true,
      lastUsedAt: undefined
    },
    {
      id: createId("key"),
      userId: demoUserId,
      protocol: "openai",
      name: "OpenCode",
      prefix: openaiKeyPlain.slice(0, 12),
      hashedSecret: sha256(openaiKeyPlain),
      createdAt: nowIso(),
      isActive: true,
      lastUsedAt: undefined
    }
  ],
  quotaPolicies: [
    {
      userId: adminId,
      mode: "unlimited",
      monthlyTokenLimit: null,
      remainingTokens: null,
      updatedAt: nowIso()
    },
    {
      userId: demoUserId,
      mode: "limited",
      monthlyTokenLimit: 120000,
      remainingTokens: 87340,
      updatedAt: nowIso()
    }
  ],
  requests: [],
  events: [],
  usageLedger: [],
  bootstrapSecrets: {
    admin: {
      email: "admin@example.com",
      password: adminPassword
    },
    demo: {
      email: "demo@example.com",
      password: userPassword,
      anthropicKey: anthropicKeyPlain,
      openaiKey: openaiKeyPlain
    }
  }
};

export function findUserByCredentials(email, password) {
  const hash = sha256(password);
  return state.users.find((user) => user.email === email && user.passwordHash === hash && user.isActive);
}

export function getUserById(userId) {
  return state.users.find((user) => user.id === userId);
}

export function getQuota(userId) {
  return state.quotaPolicies.find((policy) => policy.userId === userId);
}

export function checkQuota(userId, estimatedTokens) {
  const policy = getQuota(userId);
  if (!policy || policy.mode === "unlimited") {
    return { allowed: true, policy };
  }
  return {
    allowed: Number(policy.remainingTokens ?? 0) >= estimatedTokens,
    policy
  };
}

export function chargeQuota(userId, totalTokens) {
  const policy = getQuota(userId);
  if (!policy || policy.mode === "unlimited") {
    return;
  }
  policy.remainingTokens = Math.max(0, Number(policy.remainingTokens ?? 0) - totalTokens);
  policy.updatedAt = nowIso();
}

export function issueUserApiKey(userId, protocol, name) {
  const user = state.users.find((item) => item.id === userId && item.isActive);
  if (!user) {
    return null;
  }
  const plain = generateApiKey(protocol);
  const record = {
    id: createId("key"),
    userId,
    protocol,
    name,
    prefix: plain.slice(0, 12),
    hashedSecret: sha256(plain),
    createdAt: nowIso(),
    isActive: true,
    lastUsedAt: undefined
  };
  state.apiKeys.push(record);
  return {
    plain,
    record
  };
}

export function listUserApiKeys(userId) {
  return state.apiKeys.filter((key) => key.userId === userId);
}

export function revokeApiKey(userId, keyId) {
  const key = state.apiKeys.find((item) => item.id === keyId && item.userId === userId);
  if (!key) {
    return null;
  }
  key.isActive = false;
  return key;
}

export function findApiKey(secret, protocol) {
  const hashedSecret = sha256(secret);
  return state.apiKeys.find((key) => key.hashedSecret === hashedSecret && key.protocol === protocol && key.isActive);
}

export function selectUpstream(protocol, model) {
  const activeUpstreams = [...state.upstreams].filter((upstream) => upstream.isActive).sort((a, b) => a.priority - b.priority);
  for (const upstream of activeUpstreams) {
    const rules = state.mappings.filter((mapping) => mapping.upstreamAccountId === upstream.id && mapping.protocol === protocol);
    const exact = rules.find((rule) => !rule.isFallback && rule.requestedModel === model);
    const fallback = rules.find((rule) => rule.isFallback || rule.requestedModel === "*");
    if (exact) {
      return { upstream, mappedModel: exact.targetModel, matchedRule: exact };
    }
    if (fallback) {
      return { upstream, mappedModel: fallback.targetModel || upstream.defaultModel, matchedRule: fallback };
    }
    if (upstream.defaultModel) {
      return { upstream, mappedModel: upstream.defaultModel, matchedRule: null };
    }
  }
  return null;
}

export function persistProxyResult({
  userId,
  apiKeyId,
  protocol,
  requestedModel,
  mappedModel,
  upstreamAccountId,
  status,
  latencyMs,
  content,
  provider,
  tools,
  events
}) {
  const request = newProxyRequest({
    userId,
    apiKeyId,
    protocol,
    requestedModel,
    mappedModel,
    upstreamAccountId,
    status,
    latencyMs
  });
  state.requests.unshift(request);

  const inputTokens = estimateTokensFromText(requestedModel);
  const outputTokens = estimateTokensFromText(content);
  const cachedTokens = 0;
  const estimatedCostUsd = estimateCost(provider, inputTokens, outputTokens);
  state.usageLedger.unshift({
    id: createId("use"),
    userId,
    requestId: request.id,
    provider,
    inputTokens,
    outputTokens,
    cachedTokens,
    estimatedCostUsd,
    createdAt: nowIso()
  });
  chargeQuota(userId, inputTokens + outputTokens);

  const auditEvents = [
    ...events.map((event) => ({
      ...event,
      requestId: request.id
    })),
    ...tools.flatMap((tool) => [
      newAuditEvent(request.id, tool.direction === "call" ? "tool.call" : "tool.result", {
        name: tool.name,
        summary: tool.summary
      })
    ]),
    newAuditEvent(request.id, "usage.finalized", {
      inputTokens,
      outputTokens,
      estimatedCostUsd
    })
  ];
  state.events.unshift(...auditEvents);

  return {
    request,
    usage: {
      inputTokens,
      outputTokens,
      cachedTokens,
      estimatedCostUsd
    }
  };
}

export function getDashboardSnapshot() {
  const totalRequests = state.requests.length;
  const successfulRequests = state.requests.filter((request) => request.status === "success").length;
  const totalTokens = state.usageLedger.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0);
  return {
    totals: {
      requests: totalRequests,
      successRate: totalRequests === 0 ? 1 : Number((successfulRequests / totalRequests).toFixed(2)),
      activeUsers: state.users.filter((user) => user.isActive).length,
      monthlyTokens: totalTokens
    },
    providerHealth: state.upstreams.map((upstream) => ({
      provider: upstream.provider,
      status: upstream.isActive ? "healthy" : "offline",
      avgLatencyMs: upstream.priority * 12 + 40
    })),
    recentRequests: state.requests.slice(0, 6)
  };
}

export function buildAuditTimeline(requestId) {
  return state.events
    .filter((event) => event.requestId === requestId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createUser({ email, displayName, password, role = "user" }) {
  const user = {
    id: createId("usr"),
    email,
    displayName,
    role,
    passwordHash: sha256(password),
    isActive: true,
    createdAt: nowIso()
  };
  state.users.push(user);
  state.quotaPolicies.push({
    userId: user.id,
    mode: "limited",
    monthlyTokenLimit: 100000,
    remainingTokens: 100000,
    updatedAt: nowIso()
  });
  return user;
}

export function deleteUser(userId) {
  const user = state.users.find((item) => item.id === userId && item.role !== "admin");
  if (!user) {
    return false;
  }
  user.isActive = false;
  state.apiKeys.filter((key) => key.userId === userId).forEach((key) => {
    key.isActive = false;
  });
  return true;
}

export function updateUserStatus(userId, isActive) {
  const user = state.users.find((item) => item.id === userId && item.role !== "admin");
  if (!user) {
    return null;
  }
  user.isActive = Boolean(isActive);
  if (!user.isActive) {
    state.apiKeys.filter((key) => key.userId === userId).forEach((key) => {
      key.isActive = false;
    });
  }
  return user;
}

export function updateQuota(userId, nextPolicy) {
  const policy = getQuota(userId);
  if (!policy) {
    return null;
  }
  policy.mode = nextPolicy.mode;
  policy.monthlyTokenLimit = nextPolicy.mode === "unlimited" ? null : Number(nextPolicy.monthlyTokenLimit ?? 0);
  policy.remainingTokens = nextPolicy.mode === "unlimited" ? null : Number(nextPolicy.remainingTokens ?? policy.monthlyTokenLimit ?? 0);
  policy.updatedAt = nowIso();
  return policy;
}

export function createUpstream(input) {
  const record = {
    id: createId("up"),
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKeyMasked: maskSecret(input.apiKey),
    defaultModel: input.defaultModel,
    isActive: true,
    priority: Number(input.priority ?? 100),
    createdAt: nowIso()
  };
  state.upstreams.push(record);
  if (input.mappingDefaultModel) {
    state.mappings.push({
      id: createId("map"),
      upstreamAccountId: record.id,
      protocol: input.protocol ?? "openai",
      requestedModel: "*",
      targetModel: input.mappingDefaultModel,
      isFallback: true
    });
  }
  return record;
}

export function updateUpstream(upstreamId, input) {
  const upstream = state.upstreams.find((item) => item.id === upstreamId);
  if (!upstream) {
    return null;
  }
  upstream.name = input.name ?? upstream.name;
  upstream.provider = input.provider ?? upstream.provider;
  upstream.baseUrl = input.baseUrl ?? upstream.baseUrl;
  upstream.defaultModel = input.defaultModel ?? upstream.defaultModel;
  upstream.priority = input.priority !== undefined ? Number(input.priority) : upstream.priority;
  if (input.apiKey) {
    upstream.apiKeyMasked = maskSecret(input.apiKey);
  }

  if (input.mappingDefaultModel) {
    const fallback = state.mappings.find((mapping) => mapping.upstreamAccountId === upstreamId && mapping.protocol === (input.protocol ?? "openai") && mapping.isFallback);
    if (fallback) {
      fallback.targetModel = input.mappingDefaultModel;
    } else {
      state.mappings.push({
        id: createId("map"),
        upstreamAccountId: upstreamId,
        protocol: input.protocol ?? "openai",
        requestedModel: "*",
        targetModel: input.mappingDefaultModel,
        isFallback: true
      });
    }
  }

  return upstream;
}

export function updateUpstreamStatus(upstreamId, isActive) {
  const upstream = state.upstreams.find((item) => item.id === upstreamId);
  if (!upstream) {
    return null;
  }
  upstream.isActive = Boolean(isActive);
  return upstream;
}
