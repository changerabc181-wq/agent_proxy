import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStorePath = path.resolve(serverDir, "../../../data/routing-state.json");
const defaultAccountsStorePath = path.resolve(serverDir, "../../../data/account-state.json");
const defaultActivityStorePath = path.resolve(serverDir, "../../../data/activity-state.json");

function storePath() {
  return path.resolve(process.env.ROUTING_STATE_PATH ?? defaultStorePath);
}

function accountsStorePath() {
  return path.resolve(process.env.ACCOUNT_STATE_PATH ?? defaultAccountsStorePath);
}

function activityStorePath() {
  return path.resolve(process.env.ACTIVITY_STATE_PATH ?? defaultActivityStorePath);
}

function normalizeRoutingState(raw) {
  const upstreams = Array.isArray(raw?.upstreams)
    ? raw.upstreams.filter((item) => item && typeof item === "object")
    : [];
  const upstreamIds = new Set(upstreams.map((item) => item.id).filter(Boolean));
  const mappings = Array.isArray(raw?.mappings)
    ? raw.mappings.filter((item) => item && typeof item === "object" && upstreamIds.has(item.upstreamAccountId))
    : [];

  return { upstreams, mappings };
}

function normalizeAccountState(raw) {
  const users = Array.isArray(raw?.users)
    ? raw.users.filter((item) => item && typeof item === "object")
    : [];
  const userIds = new Set(users.map((item) => item.id).filter(Boolean));
  const quotaPolicies = Array.isArray(raw?.quotaPolicies)
    ? raw.quotaPolicies.filter((item) => item && typeof item === "object" && userIds.has(item.userId))
    : [];
  const apiKeys = Array.isArray(raw?.apiKeys)
    ? raw.apiKeys.filter((item) => item && typeof item === "object" && userIds.has(item.userId))
    : [];

  return { users, quotaPolicies, apiKeys };
}

function normalizeActivityState(raw) {
  const requests = Array.isArray(raw?.requests)
    ? raw.requests.filter((item) => item && typeof item === "object")
    : [];
  const requestIds = new Set(requests.map((item) => item.id).filter(Boolean));
  const events = Array.isArray(raw?.events)
    ? raw.events.filter((item) => item && typeof item === "object" && requestIds.has(item.requestId))
    : [];
  const usageLedger = Array.isArray(raw?.usageLedger)
    ? raw.usageLedger.filter((item) => item && typeof item === "object" && requestIds.has(item.requestId))
    : [];

  return { requests, events, usageLedger };
}

export function getRoutingStorePath() {
  return storePath();
}

export function getAccountsStorePath() {
  return accountsStorePath();
}

export function getActivityStorePath() {
  return activityStorePath();
}

export async function loadRoutingState() {
  const targetPath = storePath();

  try {
    const content = await fs.readFile(targetPath, "utf8");
    const parsed = JSON.parse(content);
    return {
      ...normalizeRoutingState(parsed),
      loadedFromDisk: true
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {
        upstreams: [],
        mappings: [],
        loadedFromDisk: false
      };
    }
    throw error;
  }
}

export async function loadAccountState() {
  const targetPath = accountsStorePath();

  try {
    const content = await fs.readFile(targetPath, "utf8");
    const parsed = JSON.parse(content);
    return {
      ...normalizeAccountState(parsed),
      loadedFromDisk: true
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {
        users: [],
        quotaPolicies: [],
        apiKeys: [],
        loadedFromDisk: false
      };
    }
    throw error;
  }
}

export async function loadActivityState() {
  const targetPath = activityStorePath();

  try {
    const content = await fs.readFile(targetPath, "utf8");
    const parsed = JSON.parse(content);
    return {
      ...normalizeActivityState(parsed),
      loadedFromDisk: true
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {
        requests: [],
        events: [],
        usageLedger: [],
        loadedFromDisk: false
      };
    }
    throw error;
  }
}

export async function persistRoutingState(routingState) {
  const targetPath = storePath();
  const directory = path.dirname(targetPath);
  const tempPath = `${targetPath}.tmp`;
  const payload = {
    upstreams: routingState.upstreams,
    mappings: routingState.mappings,
    savedAt: new Date().toISOString()
  };

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, targetPath);
  return targetPath;
}

export async function persistAccountState(accountState) {
  const targetPath = accountsStorePath();
  const directory = path.dirname(targetPath);
  const tempPath = `${targetPath}.tmp`;
  const payload = {
    users: accountState.users,
    quotaPolicies: accountState.quotaPolicies,
    apiKeys: accountState.apiKeys,
    savedAt: new Date().toISOString()
  };

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, targetPath);
  return targetPath;
}

export async function persistActivityState(activityState) {
  const targetPath = activityStorePath();
  const directory = path.dirname(targetPath);
  const tempPath = `${targetPath}.tmp`;
  const payload = {
    requests: activityState.requests,
    events: activityState.events,
    usageLedger: activityState.usageLedger,
    savedAt: new Date().toISOString()
  };

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, targetPath);
  return targetPath;
}
