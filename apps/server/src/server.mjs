import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  buildAuditTimeline,
  checkQuota,
  createUpstream,
  createUser,
  deleteUser,
  findApiKey,
  findUserByCredentials,
  getDashboardSnapshot,
  getQuota,
  getUserById,
  issueUserApiKey,
  listUserApiKeys,
  persistProxyResult,
  revokeApiKey,
  selectUpstream,
  state,
  updateUpstream,
  updateUpstreamStatus,
  updateQuota
  ,
  updateUserStatus
} from "./state.mjs";
import { createId, json, nowIso, parsePath, readJson, signToken, verifyToken } from "./utils.mjs";

const port = Number(process.env.PORT ?? 4000);
const webRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../web");

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
  const upstreamSelection = selectUpstream(protocol, requestedModel);
  if (!upstreamSelection) {
    json(res, 503, { error: "No upstream available" });
    return;
  }

  const messageText = protocol === "anthropic"
    ? summarizeMessages(requestBody.messages)
    : summarizeMessages(requestBody.messages || [{ content: requestBody.input || "" }]);
  const estimatedTokens = Math.max(32, messageText.length);
  const quota = checkQuota(user.id, estimatedTokens);
  if (!quota.allowed) {
    const rejectedRequest = persistProxyResult({
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
    });
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

  const result = persistProxyResult({
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
  });

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
    res.writeHead(200, { "content-type": contentType });
    res.end(body);
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = parsePath(req.url);

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
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role
        },
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
      const record = createUpstream(body);
      json(res, 201, record);
      return;
    }

    const adminUpstreamMatch = pathname.match(/^\/admin\/upstreams\/([^/]+)$/);
    if (adminUpstreamMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const record = body.isActive === undefined
        ? updateUpstream(adminUpstreamMatch[1], body)
        : updateUpstreamStatus(adminUpstreamMatch[1], body.isActive);
      json(res, record ? 200 : 404, record ?? { error: "Upstream not found" });
      return;
    }

    if (pathname === "/admin/users" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, state.users.map((user) => ({
        ...user,
        quota: getQuota(user.id)
      })));
      return;
    }

    if (pathname === "/admin/users" && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const user = createUser(body);
      json(res, 201, user);
      return;
    }

    const adminUserDeleteMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserDeleteMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const removed = deleteUser(adminUserDeleteMatch[1]);
      json(res, removed ? 200 : 404, { ok: removed });
      return;
    }

    if (adminUserDeleteMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const user = updateUserStatus(adminUserDeleteMatch[1], body.isActive);
      json(res, user ? 200 : 404, user ?? { error: "User not found" });
      return;
    }

    const adminQuotaMatch = pathname.match(/^\/admin\/users\/([^/]+)\/quota-policy$/);
    if (adminQuotaMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const policy = updateQuota(adminQuotaMatch[1], body);
      json(res, policy ? 200 : 404, policy ?? { error: "Quota policy not found" });
      return;
    }

    const adminApiKeyMatch = pathname.match(/^\/admin\/users\/([^/]+)\/api-keys$/);
    if (adminApiKeyMatch && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, listUserApiKeys(adminApiKeyMatch[1]));
      return;
    }

    if (adminApiKeyMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const body = await readJson(req);
      const result = issueUserApiKey(adminApiKeyMatch[1], body.protocol, body.name);
      if (!result) {
        json(res, 404, { error: "User not found or inactive" });
        return;
      }
      json(res, 201, {
        plainTextKey: result.plain,
        record: result.record
      });
      return;
    }

    const adminApiKeyDeleteMatch = pathname.match(/^\/admin\/users\/([^/]+)\/api-keys\/([^/]+)$/);
    if (adminApiKeyDeleteMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) {
        return;
      }
      const record = revokeApiKey(adminApiKeyDeleteMatch[1], adminApiKeyDeleteMatch[2]);
      json(res, record ? 200 : 404, record ?? { error: "API key not found" });
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
      json(res, 200, state.apiKeys.filter((entry) => entry.userId === user.id));
      return;
    }

    if (pathname === "/me/api-keys" && req.method === "POST") {
      const user = requireSession(req, res);
      if (!user) {
        return;
      }
      const body = await readJson(req);
      const result = issueUserApiKey(user.id, body.protocol, body.name);
      if (!result) {
        json(res, 404, { error: "User not found or inactive" });
        return;
      }
      json(res, 201, {
        plainTextKey: result.plain,
        record: result.record
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

server.listen(port, () => {
  console.log(`Agent proxy server listening on http://localhost:${port}`);
  console.log("Bootstrap credentials:");
  console.log(JSON.stringify(state.bootstrapSecrets, null, 2));
});
