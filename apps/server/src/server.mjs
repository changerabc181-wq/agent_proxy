import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  getAccountsStorePath,
  getActivityStorePath,
  getRoutingStorePath,
  loadAccountState,
  loadActivityState,
  loadRoutingState,
  persistAccountState,
  persistActivityState,
  persistRoutingState
} from "./persistence.mjs";
import {
  buildAuditTimeline,
  checkQuota,
  createUpstream,
  createUser,
  deleteApiKey,
  deleteUser,
  findApiKey,
  findUserByEmail,
  findUserByCredentials,
  getAccountStateSnapshot,
  getActivityStateSnapshot,
  getDashboardSnapshot,
  getQuota,
  getRoutingStateSnapshot,
  getUserById,
  hasAdmin,
  initializeAdmin,
  issueUserApiKey,
  listUserApiKeys,
  persistProxyResult,
  revokeApiKey,
  replaceAccountState,
  replaceActivityState,
  replaceRoutingState,
  selectUpstream,
  state,
  updateApiKeyBinding,
  updateUpstream,
  updateUpstreamStatus,
  updateQuota,
  updateUserStatus
} from "./state.mjs";
import { createId, json, nowIso, parsePath, readJson, signToken, verifyToken } from "./utils.mjs";

const port = Number(process.env.PORT ?? 4000);
const webRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../web");

async function commitAccountMutation(mutator) {
  const previous = getAccountStateSnapshot();
  try {
    const result = mutator();
    if (!result) {
      return null;
    }
    await persistAccountState(getAccountStateSnapshot());
    return result;
  } catch (error) {
    replaceAccountState(previous);
    throw error;
  }
}

async function commitRoutingMutation(mutator) {
  const previous = getRoutingStateSnapshot();
  try {
    const result = mutator();
    if (!result) {
      return null;
    }
    await persistRoutingState(getRoutingStateSnapshot());
    return result;
  } catch (error) {
    replaceRoutingState(previous);
    throw error;
  }
}

async function commitProxyMutation(mutator) {
  const previousAccounts = getAccountStateSnapshot();
  const previousActivity = getActivityStateSnapshot();
  try {
    const result = mutator();
    if (!result) {
      return null;
    }
    await Promise.all([
      persistAccountState(getAccountStateSnapshot()),
      persistActivityState(getActivityStateSnapshot())
    ]);
    return result;
  } catch (error) {
    replaceAccountState(previousAccounts);
    replaceActivityState(previousActivity);
    throw error;
  }
}

function unauthorized(res, message = "Unauthorized") {
  json(res, 401, { error: message });
}

function forbidden(res, message = "Forbidden") {
  json(res, 403, { error: message });
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function getBearer(req) {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    return null;
  }
  return value.slice("Bearer ".length);
}

function requireSession(req, res) {
  const token = getBearer(req);
  const session = token ? verifyToken(token, state.config.tokenSecret) : null;
  if (!session) {
    unauthorized(res);
    return null;
  }

  const user = getUserById(session.userId);
  if (!user || !user.isActive) {
    unauthorized(res);
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireSession(req, res);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    forbidden(res);
    return null;
  }
  return user;
}

function sessionUserPayload(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role
  };
}

function managedUserPayload(user) {
  return {
    ...sessionUserPayload(user),
    isActive: user.isActive,
    createdAt: user.createdAt,
    quota: getQuota(user.id)
  };
}

function decorateApiKeyRecord(record) {
  const upstream = record.upstreamAccountId
    ? state.upstreams.find((item) => item.id === record.upstreamAccountId)
    : null;
  return {
    ...record,
    upstreamName: upstream?.name ?? null
  };
}

function parseAccountInput(body, { defaultDisplayName } = {}) {
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const inputDisplayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const displayName = inputDisplayName || defaultDisplayName || "";

  if (!email || !password) {
    return { status: 400, error: "email and password are required" };
  }

  if (!displayName) {
    return { status: 400, error: "displayName is required" };
  }

  if (password.length < 8) {
    return { status: 400, error: "password must be at least 8 characters" };
  }

  if (findUserByEmail(email)) {
    return { status: 409, error: "User email already exists" };
  }

  return {
    value: {
      email,
      password,
      displayName
    }
  };
}

function summarizeMessages(messages = []) {
  return messages.map((entry) => (typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content))).join(" ");
}

function buildToolEvents(requestBody) {
  const tools = Array.isArray(requestBody.tools) ? requestBody.tools : [];
  return tools.slice(0, 2).flatMap((tool, index) => ([
    {
      id: createId("tool"),
      name: tool.name || `tool_${index + 1}`,
      direction: "call",
      summary: `Invoked with schema keys: ${Object.keys(tool.input_schema ?? tool.parameters ?? {}).join(", ") || "none"}`
    },
    {
      id: createId("tool"),
      name: tool.name || `tool_${index + 1}`,
      direction: "result",
      summary: "Tool execution completed in proxy trace mock"
    }
  ]));
}

function toAnthropicResponse(result, requestBody) {
  return {
    id: result.request.id,
    type: "message",
    role: "assistant",
    model: result.request.mappedModel,
    content: [
      {
        type: "text",
        text: result.content
      }
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens
    },
    trace: result.timeline,
    stream: Boolean(requestBody.stream)
  };
}

function toOpenAiResponse(result) {
  return {
    id: result.request.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.request.mappedModel,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: result.content
        }
      }
    ],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens
    },
    trace: result.timeline
  };
}

async function handleProxy(req, res, protocol) {
  const requestBody = await readJson(req);
  const apiKeySecret = req.headers["x-api-key"] || getBearer(req);
  if (!apiKeySecret) {
    unauthorized(res, "Missing API key");
    return;
  }

  const apiKey = findApiKey(apiKeySecret, protocol);
  if (!apiKey) {
    unauthorized(res, "API key is invalid for this protocol");
    return;
  }

  const user = getUserById(apiKey.userId);
  if (!user || !user.isActive) {
    unauthorized(res, "User is inactive");
    return;
  }

  const requestedModel = requestBody.model || (protocol === "anthropic" ? "claude-opus-4-1" : "gpt-4.1");
  const upstreamSelection = selectUpstream(protocol, requestedModel, apiKey.upstreamAccountId ?? null);
  if (!upstreamSelection) {
    json(res, 503, { error: apiKey.upstreamAccountId ? "No upstream available for this API key" : "No upstream available" });
    return;
  }

  const messageText = protocol === "anthropic"
    ? summarizeMessages(requestBody.messages)
    : summarizeMessages(requestBody.messages || [{ content: requestBody.input || "" }]);
  const estimatedTokens = Math.max(32, messageText.length);
  const quota = checkQuota(user.id, estimatedTokens);
  if (!quota.allowed) {
    const rejectedRequest = await commitProxyMutation(() => persistProxyResult({
      userId: user.id,
      apiKeyId: apiKey.id,
      protocol,
      requestedModel,
      mappedModel: upstreamSelection.mappedModel,
      upstreamAccountId: upstreamSelection.upstream.id,
      status: "quota_rejected",
      latencyMs: 0,
      content: "Quota rejected",
      provider: upstreamSelection.upstream.provider,
      tools: [],
      events: [
        {
          id: createId("evt"),
          requestId: "pending",
          type: "request.received",
          createdAt: nowIso(),
          payload: { protocol, requestedModel }
        },
        {
          id: createId("evt"),
          requestId: "pending",
          type: "request.failed",
          createdAt: nowIso(),
          payload: { reason: "quota_rejected" }
        }
      ]
    }));
    json(res, 402, {
      error: "Token quota exceeded",
      requestId: rejectedRequest.request.id
    });
    return;
  }

  const startedAt = Date.now();
  const toolEvents = buildToolEvents(requestBody);
  const content = [
    `Proxy handled ${protocol} request for ${requestedModel}.`,
    `Mapped to ${upstreamSelection.mappedModel} on ${upstreamSelection.upstream.provider}.`,
    messageText ? `Prompt summary: ${messageText.slice(0, 180)}` : "Prompt summary unavailable."
  ].join(" ");
  const events = [
    {
      id: createId("evt"),
      requestId: "pending",
      type: "request.received",
      createdAt: nowIso(),
      payload: {
        protocol,
        requestedModel,
        stream: Boolean(requestBody.stream)
      }
    },
    {
      id: createId("evt"),
      requestId: "pending",
      type: "auth.resolved",
      createdAt: nowIso(),
      payload: {
        userId: user.id,
        apiKeyId: apiKey.id
      }
    },
    {
      id: createId("evt"),
      requestId: "pending",
      type: "model.mapped",
      createdAt: nowIso(),
      payload: {
        requestedModel,
        mappedModel: upstreamSelection.mappedModel,
        upstream: upstreamSelection.upstream.name
      }
    },
    {
      id: createId("evt"),
      requestId: "pending",
      type: "provider.selected",
      createdAt: nowIso(),
      payload: {
        provider: upstreamSelection.upstream.provider,
        baseUrl: upstreamSelection.upstream.baseUrl
      }
    },
    {
      id: createId("evt"),
      requestId: "pending",
      type: "upstream.request.started",
      createdAt: nowIso(),
      payload: {
        targetModel: upstreamSelection.mappedModel
      }
    },
    {
      id: createId("evt"),
      requestId: "pending",
      type: "upstream.chunk",
      createdAt: nowIso(),
      payload: {
        chunkCount: Math.max(1, Math.ceil(content.length / 80)),
        summary: "Aggregated stream chunks captured for audit"
      }
    },
    {
      id: createId("evt"),
      requestId: "pending",
      type: "upstream.request.completed",
      createdAt: nowIso(),
      payload: {
        finishReason: "stop"
      }
    }
  ];

  const result = await commitProxyMutation(() => persistProxyResult({
    userId: user.id,
    apiKeyId: apiKey.id,
    protocol,
    requestedModel,
    mappedModel: upstreamSelection.mappedModel,
    upstreamAccountId: upstreamSelection.upstream.id,
    status: "success",
    latencyMs: Date.now() - startedAt,
    content,
    provider: upstreamSelection.upstream.provider,
    tools: toolEvents,
    events
  }));

  const timeline = buildAuditTimeline(result.request.id);
  const payload = {
    request: result.request,
    usage: result.usage,
    content,
    timeline
  };

  if (protocol === "anthropic") {
    json(res, 200, toAnthropicResponse(payload, requestBody));
    return;
  }

  json(res, 200, toOpenAiResponse(payload));
}

async function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(webRoot, relative);
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] ?? "text/plain; charset=utf-8";
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = parsePath(req.url);

    if (req.method === "POST" && pathname === "/setup/admin") {
      if (hasAdmin()) {
        json(res, 409, { error: "Admin already exists. Use /auth/login to sign in." });
        return;
      }
      const body = await readJson(req);
      const parsed = parseAccountInput(body, { defaultDisplayName: "Admin" });
      if (parsed.error) {
        json(res, parsed.status, { error: parsed.error });
        return;
      }
      const user = await commitAccountMutation(() => initializeAdmin(
        parsed.value.email,
        parsed.value.password,
        parsed.value.displayName
      ));
      const token = signToken({ userId: user.id, role: user.role }, state.config.tokenSecret);
      json(res, 201, {
        message: "Admin account created successfully",
        token,
        user: sessionUserPayload(user)
      });
      return;
    }

    if (req.method === "GET" && pathname === "/setup/status") {
      json(res, 200, { needsSetup: !hasAdmin() });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      const body = await readJson(req);
      const user = findUserByCredentials(body.email, body.password);
      if (!user) {
        unauthorized(res, "Invalid credentials");
        return;
      }
      const token = signToken({ userId: user.id, role: user.role }, state.config.tokenSecret);
      json(res, 200, {
        token,
        user: sessionUserPayload(user),
        bootstrap: user.role === "admin" ? state.bootstrapSecrets : undefined
      });
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, {
        ok: true,
        now: nowIso()
      });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/messages") {
      await handleProxy(req, res, "anthropic");
      return;
    }

    if (req.method === "POST" && pathname === "/v1/chat/completions") {
      await handleProxy(req, res, "openai");
      return;
    }

    if (pathname === "/admin/dashboard" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, getDashboardSnapshot());
      return;
    }

    if (pathname === "/admin/upstreams" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, state.upstreams);
      return;
    }

    if (pathname === "/admin/upstreams" && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const record = await commitRoutingMutation(() => createUpstream(body));
      json(res, 201, record);
      return;
    }

    const adminUpstreamMatch = pathname.match(/^\/admin\/upstreams\/([^/]+)$/);
    if (adminUpstreamMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const record = await commitRoutingMutation(() => (
        body.isActive === undefined
          ? updateUpstream(adminUpstreamMatch[1], body)
          : updateUpstreamStatus(adminUpstreamMatch[1], body.isActive)
      ));
      json(res, record ? 200 : 404, record ?? { error: "Upstream not found" });
      return;
    }

    if (pathname === "/admin/users" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, state.users.map((user) => managedUserPayload(user)));
      return;
    }

    if (pathname === "/admin/admins" && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const parsed = parseAccountInput(body, { defaultDisplayName: "Admin" });
      if (parsed.error) {
        json(res, parsed.status, { error: parsed.error });
        return;
      }
      const user = await commitAccountMutation(() => createUser({
        ...parsed.value,
        role: "admin"
      }));
      json(res, 201, {
        message: "Admin account created successfully",
        user: managedUserPayload(user)
      });
      return;
    }

    if (pathname === "/admin/users" && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const parsed = parseAccountInput(body);
      if (parsed.error) {
        json(res, parsed.status, { error: parsed.error });
        return;
      }
      const user = await commitAccountMutation(() => createUser({
        ...parsed.value,
        role: "user"
      }));
      json(res, 201, managedUserPayload(user));
      return;
    }

    const adminUserDeleteMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserDeleteMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const removed = await commitAccountMutation(() => deleteUser(adminUserDeleteMatch[1]));
      json(res, removed ? 200 : 404, { ok: removed });
      return;
    }

    if (adminUserDeleteMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const user = await commitAccountMutation(() => updateUserStatus(adminUserDeleteMatch[1], body.isActive));
      json(res, user ? 200 : 404, user ?? { error: "User not found" });
      return;
    }

    const adminQuotaMatch = pathname.match(/^\/admin\/users\/([^/]+)\/quota-policy$/);
    if (adminQuotaMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const policy = await commitAccountMutation(() => updateQuota(adminQuotaMatch[1], body));
      json(res, policy ? 200 : 404, policy ?? { error: "Quota policy not found" });
      return;
    }

    const adminApiKeyMatch = pathname.match(/^\/admin\/users\/([^/]+)\/api-keys$/);
    if (adminApiKeyMatch && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, listUserApiKeys(adminApiKeyMatch[1]).map((record) => decorateApiKeyRecord(record)));
      return;
    }

    if (adminApiKeyMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const result = await commitAccountMutation(() => issueUserApiKey(
        adminApiKeyMatch[1],
        body.protocol,
        body.name,
        body.upstreamAccountId
      ));
      if (!result) {
        json(res, 404, { error: "User not found, inactive, or upstream not found" });
        return;
      }
      json(res, 201, {
        plainTextKey: result.plain,
        record: decorateApiKeyRecord(result.record)
      });
      return;
    }

    const adminApiKeyDeleteMatch = pathname.match(/^\/admin\/users\/([^/]+)\/api-keys\/([^/]+)$/);
    if (adminApiKeyDeleteMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const record = await commitAccountMutation(() => updateApiKeyBinding(
        adminApiKeyDeleteMatch[1],
        adminApiKeyDeleteMatch[2],
        body.upstreamAccountId ?? null
      ));
      json(res, record ? 200 : 404, record ? decorateApiKeyRecord(record) : { error: "API key or upstream not found" });
      return;
    }

    if (adminApiKeyDeleteMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const record = await commitAccountMutation(() => revokeApiKey(adminApiKeyDeleteMatch[1], adminApiKeyDeleteMatch[2]));
      json(res, record ? 200 : 404, record ? decorateApiKeyRecord(record) : { error: "API key not found" });
      return;
    }

    const adminApiKeyPermanentDeleteMatch = pathname.match(/^\/admin\/users\/([^/]+)\/api-keys\/([^/]+)\/permanent$/);
    if (adminApiKeyPermanentDeleteMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const record = await commitAccountMutation(() => deleteApiKey(
        adminApiKeyPermanentDeleteMatch[1],
        adminApiKeyPermanentDeleteMatch[2]
      ));
      json(res, record ? 200 : 404, record ? decorateApiKeyRecord(record) : { error: "API key not found" });
      return;
    }

    if (pathname === "/admin/requests" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, state.requests.map((request) => ({
        ...request,
        usage: state.usageLedger.find((entry) => entry.requestId === request.id)
      })));
      return;
    }

    if (pathname === "/admin/api-keys" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, state.apiKeys.map(key => {
        const user = getUserById(key.userId);
        return {
          ...decorateApiKeyRecord(key),
          userEmail: user?.email,
          userDisplayName: user?.displayName
        };
      }));
      return;
    }

    const adminRequestMatch = pathname.match(/^\/admin\/requests\/([^/]+)$/);
    if (adminRequestMatch && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const request = state.requests.find((entry) => entry.id === adminRequestMatch[1]);
      if (!request) {
        notFound(res);
        return;
      }
      json(res, 200, {
        request,
        usage: state.usageLedger.find((entry) => entry.requestId === request.id),
        timeline: buildAuditTimeline(request.id)
      });
      return;
    }

    if (pathname === "/me/api-keys" && req.method === "GET") {
      const user = requireSession(req, res);
      if (!user) {
        return;
      }
      json(res, 200, state.apiKeys.filter((entry) => entry.userId === user.id).map((record) => decorateApiKeyRecord(record)));
      return;
    }

    if (pathname === "/me/api-keys" && req.method === "POST") {
      const user = requireSession(req, res);
      if (!user) {
        return;
      }
      const body = await readJson(req);
      const result = await commitAccountMutation(() => issueUserApiKey(
        user.id,
        body.protocol,
        body.name,
        body.upstreamAccountId
      ));
      if (!result) {
        json(res, 404, { error: "User not found, inactive, or upstream not found" });
        return;
      }
      json(res, 201, {
        plainTextKey: result.plain,
        record: decorateApiKeyRecord(result.record)
      });
      return;
    }

    if (pathname === "/me/usage" && req.method === "GET") {
      const user = requireSession(req, res);
      if (!user) {
        return;
      }
      json(res, 200, {
        quota: getQuota(user.id),
        entries: state.usageLedger.filter((entry) => entry.userId === user.id)
      });
      return;
    }

    if (pathname === "/me/requests" && req.method === "GET") {
      const user = requireSession(req, res);
      if (!user) {
        return;
      }
      json(res, 200, state.requests.filter((entry) => entry.userId === user.id));
      return;
    }

    const meRequestMatch = pathname.match(/^\/me\/requests\/([^/]+)$/);
    if (meRequestMatch && req.method === "GET") {
      const user = requireSession(req, res);
      if (!user) {
        return;
      }
      const request = state.requests.find((entry) => entry.id === meRequestMatch[1] && entry.userId === user.id);
      if (!request) {
        notFound(res);
        return;
      }
      json(res, 200, {
        request,
        usage: state.usageLedger.find((entry) => entry.requestId === request.id),
        timeline: buildAuditTimeline(request.id)
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, pathname);
      return;
    }

    notFound(res);
  } catch (error) {
    json(res, 500, {
      error: "Internal server error",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

async function bootstrap() {
  const loadedAccounts = await loadAccountState();
  replaceAccountState(loadedAccounts);
  if (loadedAccounts.loadedFromDisk) {
    console.log(`Loaded ${loadedAccounts.users.length} persisted account(s) from ${getAccountsStorePath()}`);
  } else {
    console.log(`No persisted accounts found at ${getAccountsStorePath()}`);
  }

  const loadedActivity = await loadActivityState();
  replaceActivityState(loadedActivity);
  if (loadedActivity.loadedFromDisk) {
    console.log(`Loaded ${loadedActivity.requests.length} persisted request(s) from ${getActivityStorePath()}`);
  } else {
    console.log(`No persisted activity found at ${getActivityStorePath()}`);
  }

  const loaded = await loadRoutingState();
  replaceRoutingState(loaded);
  if (loaded.loadedFromDisk) {
    console.log(`Loaded ${loaded.upstreams.length} persisted upstream route(s) from ${getRoutingStorePath()}`);
  } else {
    console.log(`No persisted upstream routes found at ${getRoutingStorePath()}`);
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminDisplayName = process.env.ADMIN_DISPLAY_NAME;

  if (adminEmail && adminPassword) {
    if (!hasAdmin()) {
      const user = await commitAccountMutation(() => initializeAdmin(adminEmail, adminPassword, adminDisplayName));
      console.log(`Admin account created: ${user.email} (${user.displayName})`);
    } else {
      console.log("Admin already exists, skipping ADMIN_EMAIL/ADMIN_PASSWORD seed.");
    }
  }

  server.listen(port, () => {
    console.log(`Agent proxy server listening on http://localhost:${port}`);

    if (!adminEmail || !adminPassword) {
      if (!hasAdmin()) {
        console.log("No admin account configured.");
        console.log(`Run the setup tool: node scripts/create-admin.mjs --url http://localhost:${port}`);
        console.log("Or set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before starting the server.");
      }
    } else if (!hasAdmin()) {
      console.log("No admin account configured.");
      console.log(`Run the setup tool: node scripts/create-admin.mjs --url http://localhost:${port}`);
      console.log("Or set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before starting the server.");
    }
  });
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap agent proxy server.");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
