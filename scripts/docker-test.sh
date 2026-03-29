#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-http://127.0.0.1:4000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

echo "[1/5] Health check"
curl -fsS "${APP_URL}/health"
echo

echo "[2/5] Admin login"
LOGIN_RESPONSE="$(curl -fsS -X POST "${APP_URL}/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")"
echo "${LOGIN_RESPONSE}"
ADMIN_TOKEN="$(printf '%s' "${LOGIN_RESPONSE}" | sed -n 's/.*"token": "\([^"]*\)".*/\1/p')"
DEMO_ANTHROPIC_KEY="$(printf '%s' "${LOGIN_RESPONSE}" | sed -n 's/.*"anthropicKey": "\([^"]*\)".*/\1/p')"
DEMO_OPENAI_KEY="$(printf '%s' "${LOGIN_RESPONSE}" | sed -n 's/.*"openaiKey": "\([^"]*\)".*/\1/p')"

echo "[3/5] Admin dashboard"
curl -fsS "${APP_URL}/admin/dashboard" \
  -H "authorization: Bearer ${ADMIN_TOKEN}"
echo

echo "[4/5] Claude-compatible proxy"
curl -fsS -X POST "${APP_URL}/v1/messages" \
  -H "x-api-key: ${DEMO_ANTHROPIC_KEY}" \
  -H 'content-type: application/json' \
  -d '{
    "model": "claude-opus-4-1",
    "stream": false,
    "messages": [{"role": "user", "content": "call weather tool for shanghai"}],
    "tools": [{"name": "weather_lookup", "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}}}]
  }'
echo

echo "[5/5] OpenAI-compatible proxy"
curl -fsS -X POST "${APP_URL}/v1/chat/completions" \
  -H "x-api-key: ${DEMO_OPENAI_KEY}" \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-4.1",
    "messages": [{"role": "user", "content": "summarize audit visibility"}]
  }'
echo

echo "Docker verification completed."
