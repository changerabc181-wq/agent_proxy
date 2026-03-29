# Agent Proxy Prototype

This repository contains a runnable prototype for a personal agent proxy control plane:

- Claude-compatible proxy endpoint: `POST /v1/messages`
- OpenAI-compatible proxy endpoint: `POST /v1/chat/completions`
- Admin console and user portal served from the same Node process
- JWT-based admin and user sessions
- Per-protocol API keys
- Upstream registry, model mapping, quota checks, usage ledger, and audit timeline

## Run

```bash
cd /home/admin/gameboy-workspace/agent_proxy
node apps/server/src/server.mjs
```

The server prints bootstrap credentials and demo API keys on startup.

Open `http://localhost:4000`.

## Docker

Bring up the app and MySQL:

```bash
cd /home/admin/gameboy-workspace/agent_proxy
bash scripts/docker-up.sh
```

Run the verification flow:

```bash
bash scripts/docker-test.sh
```

Stop everything:

```bash
bash scripts/docker-down.sh
```

## Prototype Notes

- Upstream routes and model mappings are persisted to `data/routing-state.json`.
- Accounts, quotas, and issued API keys are persisted to `data/account-state.json`.
- Requests, audit events, and usage ledger entries are persisted to `data/activity-state.json`.
- The MySQL schema lives in [`docs/mysql-schema.sql`](/home/admin/gameboy-workspace/agent_proxy/docs/mysql-schema.sql).
- The upstream forwarding path is modeled end-to-end, but actual network calls are mocked so the prototype runs without external dependencies.
- The UI is a static SPA served by the backend to demonstrate the intended operator and user workflows.
