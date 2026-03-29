export type Role = "admin" | "user";

export type ProtocolKind = "anthropic" | "openai";

export type ProviderKind = "openrouter" | "minimax" | "generic-openai";

export type QuotaMode = "limited" | "unlimited";

export type RequestStatus = "success" | "upstream_error" | "quota_rejected" | "auth_rejected";

export type EventType =
  | "request.received"
  | "auth.resolved"
  | "model.mapped"
  | "provider.selected"
  | "upstream.request.started"
  | "upstream.chunk"
  | "tool.call"
  | "tool.result"
  | "upstream.request.completed"
  | "usage.finalized"
  | "request.failed";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  isActive: boolean;
  createdAt: string;
}

export interface UpstreamAccount {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  apiKeyMasked: string;
  defaultModel: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
}

export interface ModelMappingRule {
  id: string;
  upstreamAccountId: string;
  protocol: ProtocolKind;
  requestedModel: string;
  targetModel: string;
  isFallback: boolean;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  protocol: ProtocolKind;
  name: string;
  upstreamAccountId?: string | null;
  upstreamName?: string | null;
  plainTextKey?: string | null;
  prefix: string;
  hashedSecret: string;
  lastUsedAt?: string;
  createdAt: string;
  isActive: boolean;
}

export interface QuotaPolicy {
  userId: string;
  mode: QuotaMode;
  monthlyTokenLimit?: number;
  remainingTokens?: number;
  updatedAt: string;
}

export interface UsageLedgerEntry {
  id: string;
  userId: string;
  requestId: string;
  provider: ProviderKind;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  createdAt: string;
}

export interface ProxyRequestRecord {
  id: string;
  userId: string;
  apiKeyId: string;
  protocol: ProtocolKind;
  requestedModel: string;
  mappedModel: string;
  upstreamAccountId: string;
  status: RequestStatus;
  latencyMs: number;
  createdAt: string;
}

export interface ProxyEventRecord {
  id: string;
  requestId: string;
  type: EventType;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface NormalizedToolEvent {
  id: string;
  name: string;
  direction: "call" | "result";
  summary: string;
}

export interface NormalizedProxyRequest {
  protocol: ProtocolKind;
  model: string;
  stream: boolean;
  messages: Array<{
    role: string;
    content: string;
  }>;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  metadata?: Record<string, string>;
}

export interface NormalizedProxyResponse {
  requestId: string;
  protocol: ProtocolKind;
  provider: ProviderKind;
  requestedModel: string;
  mappedModel: string;
  content: string;
  outputText: string;
  finishReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedCostUsd: number;
  };
  tools: NormalizedToolEvent[];
  chunks: Array<{
    index: number;
    summary: string;
  }>;
}

export interface DashboardSnapshot {
  totals: {
    requests: number;
    successRate: number;
    activeUsers: number;
    monthlyTokens: number;
  };
  providerHealth: Array<{
    name: string;
    status: "healthy" | "degraded" | "offline";
    avgLatencyMs: number;
  }>;
  recentRequests: ProxyRequestRecord[];
}
