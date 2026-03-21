import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  const [body, sig] = token.split(".");
  if (!body || !sig) {
    return null;
  }

  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (expected !== sig) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function generateApiKey(protocol) {
  const secret = `${protocol.slice(0, 3)}_${crypto.randomBytes(18).toString("hex")}`;
  return `sk_ap_${secret}`;
}

export function maskSecret(secret) {
  return `${secret.slice(0, 8)}...${secret.slice(-4)}`;
}

export function estimateTokensFromText(value) {
  return Math.max(1, Math.ceil(value.trim().split(/\s+/).filter(Boolean).length * 1.3));
}

export function estimateCost(provider, inputTokens, outputTokens) {
  const rates = {
    openrouter: 0.000003,
    minimax: 0.000002,
    "generic-openai": 0.0000025
  };
  const rate = rates[provider] ?? rates["generic-openai"];
  return Number(((inputTokens + outputTokens) * rate).toFixed(6));
}

export function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function parsePath(url) {
  const parsed = new URL(url, "http://localhost");
  return {
    pathname: parsed.pathname,
    searchParams: parsed.searchParams
  };
}

