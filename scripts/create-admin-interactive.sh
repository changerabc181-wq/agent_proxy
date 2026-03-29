#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_SCRIPT="$ROOT_DIR/scripts/create-admin.mjs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "未找到命令: $1"
}

prompt_email() {
  local __var_name="$1"
  local prompt_text="$2"
  local value

  while true; do
    read -rp "$prompt_text" value
    value="${value// /}"
    if [[ "$value" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
      printf -v "$__var_name" '%s' "$value"
      return
    fi
    warn "邮箱格式不正确，请重新输入。"
  done
}

prompt_hidden() {
  local __var_name="$1"
  local prompt_text="$2"
  local value

  while true; do
    read -rsp "$prompt_text" value
    echo ""
    if [[ -n "$value" ]]; then
      printf -v "$__var_name" '%s' "$value"
      return
    fi
    warn "输入不能为空。"
  done
}

prompt_password_with_confirm() {
  local __var_name="$1"
  local password confirm

  while true; do
    read -rsp "新管理员密码 (至少 8 位): " password
    echo ""
    if [[ ${#password} -lt 8 ]]; then
      warn "密码长度至少需要 8 位。"
      continue
    fi

    read -rsp "确认密码: " confirm
    echo ""
    if [[ "$password" != "$confirm" ]]; then
      warn "两次输入的密码不一致，请重新输入。"
      continue
    fi

    printf -v "$__var_name" '%s' "$password"
    return
  done
}

print_summary() {
  local auth_label="$1"

  echo ""
  echo "---------------- 执行信息 ----------------"
  echo "服务地址:      $SERVER_URL"
  echo "新管理员邮箱:  $NEW_ADMIN_EMAIL"
  echo "显示名称:      $NEW_ADMIN_NAME"
  echo "认证方式:      $auth_label"
  echo "------------------------------------------"
  echo ""
}

echo ""
echo "================================================================"
echo "         Agent Proxy 管理员创建向导"
echo "================================================================"
echo ""

require_command node
[[ -f "$NODE_SCRIPT" ]] || die "未找到脚本: $NODE_SCRIPT"

read -rp "Agent Proxy 地址 [http://localhost:4000]: " SERVER_URL
SERVER_URL="${SERVER_URL:-http://localhost:4000}"

echo ""
echo "--- 新管理员信息 ---"
prompt_email NEW_ADMIN_EMAIL "新管理员邮箱: "
read -rp "显示名称 [Admin]: " NEW_ADMIN_NAME
NEW_ADMIN_NAME="${NEW_ADMIN_NAME:-Admin}"
prompt_password_with_confirm NEW_ADMIN_PASSWORD

echo ""
echo "--- 可选认证信息 ---"
echo "如果系统里已经有管理员，你可以现在提供认证信息。"
echo "如果直接回车，底层工具会在需要时继续询问。"
read -rp "认证方式 [1=管理员邮箱密码, 2=Bearer Token, 回车=稍后输入]: " AUTH_MODE

AUTH_LABEL="运行时按需输入"
CMD=(
  node
  "$NODE_SCRIPT"
  --url "$SERVER_URL"
  --email "$NEW_ADMIN_EMAIL"
  --password "$NEW_ADMIN_PASSWORD"
  --name "$NEW_ADMIN_NAME"
)

case "$AUTH_MODE" in
  1)
    AUTH_LABEL="管理员邮箱密码"
    prompt_email LOGIN_EMAIL "现有管理员邮箱: "
    prompt_hidden LOGIN_PASSWORD "现有管理员密码: "
    CMD+=(--login-email "$LOGIN_EMAIL" --login-password "$LOGIN_PASSWORD")
    ;;
  2)
    AUTH_LABEL="Bearer Token"
    prompt_hidden ADMIN_TOKEN "管理员 Bearer Token: "
    CMD+=(--token "$ADMIN_TOKEN")
    ;;
  "")
    ;;
  *)
    warn "未识别的认证方式，执行时将按需继续询问。"
    ;;
esac

print_summary "$AUTH_LABEL"

read -rp "确认开始创建管理员？[Y/n]: " CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  die "已取消。"
fi

cd "$ROOT_DIR"
"${CMD[@]}"
success "交互脚本执行完成。"
