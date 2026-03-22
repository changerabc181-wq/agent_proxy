#!/usr/bin/env bash
# =============================================================================
# Agent Proxy 安装脚本
# =============================================================================
# 用法:
#   bash scripts/install.sh [选项]
#
# 选项:
#   --compose         使用 Docker Compose 方式部署（推荐，含 MySQL）
#   --docker          使用单容器 Docker 方式部署
#   --port <port>     服务端口（默认: 4000）
#   --skip-start      仅配置，不启动服务
#   --non-interactive 非交互模式，通过环境变量传入参数
#                     (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_DISPLAY_NAME)
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------- 颜色输出 ----------
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

# ---------- 解析参数 ----------
USE_DOCKER=false
USE_COMPOSE=false
APP_PORT=4000
SKIP_START=false
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose)        USE_COMPOSE=true; USE_DOCKER=true; shift ;;
    --docker)         USE_DOCKER=true; shift ;;
    --port)           APP_PORT="$2"; shift 2 ;;
    --skip-start)     SKIP_START=true; shift ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    *) warn "未知选项: $1"; shift ;;
  esac
done

# ---------- 欢迎信息 ----------
echo ""
echo "================================================================"
echo "         Agent Proxy 安装向导"
echo "================================================================"
echo ""

# ---------- 检查 Node.js ----------
check_node() {
  if ! command -v node &>/dev/null; then
    die "未找到 Node.js，请先安装 Node.js 18 或更高版本。\n  下载: https://nodejs.org/"
  fi

  local version
  version="$(node --version | sed 's/v//')"
  local major
  major="$(echo "$version" | cut -d. -f1)"

  if [[ "$major" -lt 18 ]]; then
    die "Node.js 版本过低 (当前: v${version})，需要 v18 或更高版本。"
  fi

  success "Node.js v${version}"
}

# ---------- 检查 Docker ----------
check_docker() {
  if ! command -v docker &>/dev/null; then
    die "未找到 Docker，请先安装 Docker Engine。\n  下载: https://docs.docker.com/get-docker/"
  fi
  if ! docker info &>/dev/null; then
    die "Docker 守护进程未运行，请先启动 Docker。"
  fi
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
}

# ---------- 检查 Docker Compose ----------
check_compose() {
  check_docker
  if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    die "未找到 Docker Compose，请安装 Docker Compose v2 或更高版本。\n  下载: https://docs.docker.com/compose/install/"
  fi
  success "Docker Compose (${COMPOSE_CMD})"
}

# ---------- 安装 npm 依赖 ----------
install_deps() {
  info "安装 npm 依赖..."
  cd "$ROOT_DIR"
  npm install --silent
  success "依赖安装完成"
}

# ---------- 收集管理员信息 ----------
collect_admin_info() {
  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    ADMIN_EMAIL="${ADMIN_EMAIL:-}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
    ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-Admin}"

    [[ -z "$ADMIN_EMAIL" ]]    && die "非交互模式需要设置环境变量 ADMIN_EMAIL"
    [[ -z "$ADMIN_PASSWORD" ]] && die "非交互模式需要设置环境变量 ADMIN_PASSWORD"
    return
  fi

  echo ""
  echo "--- 创建管理员账号 ---"
  echo ""

  # 邮箱
  while true; do
    read -rp "管理员邮箱: " ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL// /}"
    if [[ "$ADMIN_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
      break
    fi
    warn "邮箱格式不正确，请重新输入。"
  done

  # 显示名称
  read -rp "显示名称 [Admin]: " ADMIN_DISPLAY_NAME
  ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-Admin}"

  # 密码（隐藏输入）
  while true; do
    read -rsp "管理员密码 (至少 8 位): " ADMIN_PASSWORD
    echo ""
    if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
      warn "密码长度至少需要 8 位。"
      continue
    fi
    read -rsp "确认密码: " ADMIN_PASSWORD_CONFIRM
    echo ""
    if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
      warn "两次输入的密码不一致，请重新输入。"
      continue
    fi
    break
  done
}

# ---------- 生成随机密码 ----------
gen_password() {
  # 生成 16 位随机字符串作为密码
  node -e "const c=require('node:crypto');process.stdout.write(c.randomBytes(12).toString('base64url'))"
}

# ---------- 生成 .env 文件 ----------
write_env_file() {
  local env_file="$ROOT_DIR/.env"

  # 生成随机 TOKEN_SECRET
  local token_secret
  token_secret="$(node -e "const c=require('node:crypto');process.stdout.write(c.randomBytes(32).toString('hex'))")"

  # 生成 MySQL 随机密码（仅首次生成时写入）
  local mysql_password mysql_root_password
  if [[ -f "$env_file" ]] && grep -q "MYSQL_PASSWORD=" "$env_file"; then
    mysql_password="$(grep "^MYSQL_PASSWORD=" "$env_file" | cut -d= -f2)"
    mysql_root_password="$(grep "^MYSQL_ROOT_PASSWORD=" "$env_file" | cut -d= -f2)"
  else
    mysql_password="$(gen_password)"
    mysql_root_password="$(gen_password)"
  fi

  cat > "$env_file" <<EOF
# Agent Proxy 配置文件 - 由 install.sh 生成
# 生成时间: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

APP_PORT=${APP_PORT}

# JWT 签名密钥（请勿泄漏）
TOKEN_SECRET=${token_secret}

# 首次启动时自动创建管理员账号
# 管理员创建成功后这两个变量可以从此文件中删除
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_DISPLAY_NAME=${ADMIN_DISPLAY_NAME}

# MySQL 配置（Docker Compose 模式使用，3306 端口仅限内部访问）
MYSQL_DATABASE=agent_proxy
MYSQL_USER=agent_proxy
MYSQL_PASSWORD=${mysql_password}
MYSQL_ROOT_PASSWORD=${mysql_root_password}
EOF

  success ".env 文件已生成: $env_file"
  warn "请妥善保管 .env 文件，不要将其提交到版本控制系统。"
}

# ---------- 本地启动 ----------
start_local() {
  info "正在启动服务器 (端口: ${APP_PORT})..."

  # 加载 .env
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_DIR/.env"
    set +a
  fi

  cd "$ROOT_DIR"
  nohup node apps/server/src/server.mjs > "$ROOT_DIR/server.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$ROOT_DIR/server.pid"

  # 等待启动
  local max_wait=20
  local waited=0
  while [[ $waited -lt $max_wait ]]; do
    if curl -sf "http://localhost:${APP_PORT}/health" &>/dev/null; then
      break
    fi
    sleep 1
    ((waited++))
  done

  if ! curl -sf "http://localhost:${APP_PORT}/health" &>/dev/null; then
    die "服务器启动超时，请查看日志: $ROOT_DIR/server.log"
  fi

  success "服务器已启动 (PID: $pid)"

  # 调用 create-admin 完成管理员创建
  info "正在创建管理员账号..."
  node "$ROOT_DIR/scripts/create-admin.mjs" \
    --url "http://localhost:${APP_PORT}" \
    --email "$ADMIN_EMAIL" \
    --password "$ADMIN_PASSWORD" \
    --name "$ADMIN_DISPLAY_NAME" 2>/dev/null || true
}

# ---------- Docker Compose 启动 ----------
start_compose() {
  info "使用 Docker Compose 启动服务..."

  cd "$ROOT_DIR"

  # 停止并清理旧容器（保留数据卷）
  $COMPOSE_CMD down --remove-orphans 2>/dev/null || true

  info "构建并启动容器..."
  $COMPOSE_CMD up -d --build

  # 等待 app 健康
  local max_wait=60
  local waited=0
  while [[ $waited -lt $max_wait ]]; do
    if curl -sf "http://localhost:${APP_PORT}/health" &>/dev/null; then
      break
    fi
    sleep 2
    ((waited += 2))
  done

  if ! curl -sf "http://localhost:${APP_PORT}/health" &>/dev/null; then
    die "服务启动超时，请检查日志: ${COMPOSE_CMD} logs"
  fi

  success "服务已启动"
}

# ---------- Docker 启动 ----------
start_docker() {
  local image_name="agent-proxy:latest"
  local container_name="agent-proxy"

  info "构建 Docker 镜像..."
  docker build -t "$image_name" "$ROOT_DIR" -q
  success "镜像构建完成: $image_name"

  # 停止旧容器
  if docker ps -a --format '{{.Names}}' | grep -qx "$container_name"; then
    info "停止旧容器..."
    docker rm -f "$container_name" >/dev/null
  fi

  info "启动容器..."
  docker run -d \
    --name "$container_name" \
    -p "${APP_PORT}:4000" \
    -e PORT=4000 \
    -e TOKEN_SECRET="$(grep TOKEN_SECRET "$ROOT_DIR/.env" | cut -d= -f2)" \
    -e ADMIN_EMAIL="$ADMIN_EMAIL" \
    -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    -e ADMIN_DISPLAY_NAME="$ADMIN_DISPLAY_NAME" \
    "$image_name" >/dev/null

  # 等待健康检查
  local max_wait=30
  local waited=0
  while [[ $waited -lt $max_wait ]]; do
    if curl -sf "http://localhost:${APP_PORT}/health" &>/dev/null; then
      break
    fi
    sleep 1
    ((waited++))
  done

  if ! curl -sf "http://localhost:${APP_PORT}/health" &>/dev/null; then
    die "容器启动超时，请检查: docker logs $container_name"
  fi

  success "容器已启动: $container_name"
}

# ---------- 打印完成信息 ----------
print_summary() {
  echo ""
  echo "================================================================"
  success "安装完成！"
  echo "================================================================"
  echo ""
  echo "  访问地址:    http://localhost:${APP_PORT}"
  echo "  管理员邮箱:  ${ADMIN_EMAIL}"
  echo ""
  echo "  常用命令:"
  if [[ "$USE_COMPOSE" == "true" ]]; then
    echo "    查看日志:  ${COMPOSE_CMD} logs -f"
    echo "    停止服务:  ${COMPOSE_CMD} down"
    echo "    重启服务:  ${COMPOSE_CMD} restart"
    echo "    重建镜像:  ${COMPOSE_CMD} up -d --build"
    echo "    查看状态:  ${COMPOSE_CMD} ps"
  elif [[ "$USE_DOCKER" == "true" ]]; then
    echo "    查看日志:  docker logs -f agent-proxy-app"
    echo "    停止服务:  docker stop agent-proxy-app"
    echo "    重启服务:  docker restart agent-proxy-app"
  else
    echo "    查看日志:  tail -f ${ROOT_DIR}/server.log"
    echo "    停止服务:  kill \$(cat ${ROOT_DIR}/server.pid)"
    echo "    重新启动:  bash scripts/install.sh --skip-start && source .env && node apps/server/src/server.mjs"
  fi
  echo ""
  echo "  创建额外管理员:"
  echo "    node scripts/create-admin.mjs --url http://localhost:${APP_PORT}"
  echo ""
}

# ==================== 主流程 ====================

if [[ "$USE_COMPOSE" == "true" ]]; then
  check_compose
elif [[ "$USE_DOCKER" == "true" ]]; then
  check_docker
else
  check_node
  install_deps
fi

collect_admin_info

write_env_file

if [[ "$SKIP_START" == "true" ]]; then
  info "已跳过服务启动 (--skip-start)。"
  if [[ "$USE_COMPOSE" == "true" ]]; then
    info "手动启动命令:"
    echo "  ${COMPOSE_CMD} up -d --build"
  else
    info "手动启动命令:"
    echo "  source .env && node apps/server/src/server.mjs"
  fi
  echo ""
  exit 0
fi

if [[ "$USE_COMPOSE" == "true" ]]; then
  start_compose
elif [[ "$USE_DOCKER" == "true" ]]; then
  start_docker
else
  start_local
fi

print_summary
