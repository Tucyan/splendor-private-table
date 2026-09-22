#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Update the single-instance deployment without touching /etc/splendor.env.
REPO_URL="${SPLENDOR_REPO_URL:-https://github.com/Tucyan/splendor-private-table.git}"
BRANCH="${SPLENDOR_BRANCH:-main}"
APP_DIR="${SPLENDOR_APP_DIR:-/opt/splendor}"
SERVICE="${SPLENDOR_SERVICE:-splendor}"
ENV_FILE="${SPLENDOR_ENV_FILE:-/etc/splendor.env}"
NODE_BIN="${SPLENDOR_NODE:-/opt/node-v24.11.1-linux-x64/bin/node}"
HEALTH_URL="${SPLENDOR_HEALTH_URL:-http://127.0.0.1:3030/api/health}"
OWNER="${SPLENDOR_OWNER:-splendor:splendor}"
CLONE_ATTEMPTS="${SPLENDOR_CLONE_ATTEMPTS:-3}"
CLONE_RETRY_DELAY="${SPLENDOR_CLONE_RETRY_DELAY:-3}"
HEALTH_ATTEMPTS="${SPLENDOR_HEALTH_ATTEMPTS:-30}"
HEALTH_RETRY_DELAY="${SPLENDOR_HEALTH_RETRY_DELAY:-1}"
GIT_LOW_SPEED_LIMIT="${SPLENDOR_GIT_LOW_SPEED_LIMIT:-1024}"
GIT_LOW_SPEED_TIME="${SPLENDOR_GIT_LOW_SPEED_TIME:-30}"
UPDATE_SERVICE_UNIT=1
SKIP_TESTS=0
LOCK_DIR="/var/lock/splendor-update.lock.d"
TEMP_DIR=""
BACKUP_DIR=""
FAILED_DIR=""
SWAPPED=0
SERVICE_WAS_ACTIVE=0

usage() {
  cat <<'EOF'
用法：sudo bash deploy/update.sh [选项]

选项：
  --branch NAME             更新分支，默认 main
  --repo URL                Git 仓库地址
  --app-dir PATH            应用目录，默认 /opt/splendor
  --service NAME            systemd 服务名，默认 splendor
  --health-url URL          健康检查地址
  --keep-service-unit       不安装仓库中的 deploy/splendor.service
  --skip-tests              跳过临时目录中的 Node 测试
  -h, --help                显示帮助

环境文件始终使用独立的 /etc/splendor.env，不会从仓库复制或覆盖。
EOF
}

die() { printf '更新失败：%s\n' "$*" >&2; exit 1; }
log() { printf '[splendor-update] %s\n' "$*"; }

clone_with_retry() {
  local repo=$1 branch=$2 parent=$3 attempt candidate
  for ((attempt=1; attempt<=CLONE_ATTEMPTS; attempt++)); do
    candidate="$(mktemp -d "$parent/.splendor-update.XXXXXX")"
    if git -c http.version=HTTP/1.1 \
      -c "http.lowSpeedLimit=$GIT_LOW_SPEED_LIMIT" \
      -c "http.lowSpeedTime=$GIT_LOW_SPEED_TIME" \
      clone --depth 1 --branch "$branch" "$repo" "$candidate"; then
      TEMP_DIR=$candidate
      return 0
    fi
    [[ $candidate == "$parent"/.splendor-update.* && $parent != / ]] && rm -rf -- "$candidate"
    if (( attempt < CLONE_ATTEMPTS )); then
      log "下载连接中断，${CLONE_RETRY_DELAY} 秒后重试（$attempt/$CLONE_ATTEMPTS）"
      sleep "$CLONE_RETRY_DELAY"
    fi
  done
  return 1
}

wait_for_health() {
  local service=$1 url=$2 attempt
  for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++)); do
    if systemctl is-active --quiet "$service" &&
       curl --fail --silent --max-time 3 "$url" 2>/dev/null |
         grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
      return 0
    fi
    (( attempt < HEALTH_ATTEMPTS )) && sleep "$HEALTH_RETRY_DELAY"
  done
  return 1
}

if [[ ${SPLENDOR_UPDATE_TESTING:-0} == 1 ]]; then
  return 0 2>/dev/null || exit 0
fi

while (($#)); do
  case "$1" in
    --branch) [[ $# -ge 2 ]] || die "--branch 缺少参数"; BRANCH=$2; shift 2 ;;
    --repo) [[ $# -ge 2 ]] || die "--repo 缺少参数"; REPO_URL=$2; shift 2 ;;
    --app-dir) [[ $# -ge 2 ]] || die "--app-dir 缺少参数"; APP_DIR=$2; shift 2 ;;
    --service) [[ $# -ge 2 ]] || die "--service 缺少参数"; SERVICE=$2; shift 2 ;;
    --health-url) [[ $# -ge 2 ]] || die "--health-url 缺少参数"; HEALTH_URL=$2; shift 2 ;;
    --keep-service-unit) UPDATE_SERVICE_UNIT=0; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知选项：$1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "请使用 sudo 执行，例如：sudo bash deploy/update.sh"
[[ $APP_DIR == /* && $APP_DIR != / && $APP_DIR != */.. && $APP_DIR != */. ]] || die "应用目录不安全：$APP_DIR"
[[ $SERVICE =~ ^[A-Za-z0-9_.@-]+$ ]] || die "服务名不安全：$SERVICE"
[[ -n $BRANCH && -n $REPO_URL ]] || die "仓库和分支不能为空"
[[ $CLONE_ATTEMPTS =~ ^[1-9][0-9]*$ && $HEALTH_ATTEMPTS =~ ^[1-9][0-9]*$ ]] || die "重试次数必须为正整数"
[[ $GIT_LOW_SPEED_LIMIT =~ ^[1-9][0-9]*$ && $GIT_LOW_SPEED_TIME =~ ^[1-9][0-9]*$ ]] || die "Git 低速阈值必须为正整数"

for command in git systemctl curl mktemp mv date cmp install grep getent rm; do
  command -v "$command" >/dev/null 2>&1 || die "缺少命令：$command"
done
[[ -x $NODE_BIN ]] || NODE_BIN="$(command -v node || true)"
[[ -x ${NODE_BIN:-} ]] || die "找不到 Node.js 22+，可设置 SPLENDOR_NODE"
[[ -f $ENV_FILE ]] || die "找不到环境文件 $ENV_FILE；不会在更新时自动创建密钥文件"
[[ -d $(dirname "$APP_DIR") ]] || die "应用目录的父目录不存在：$(dirname "$APP_DIR")"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  die "已有另一个更新任务运行（锁目录：$LOCK_DIR）"
fi
cleanup_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup_lock EXIT

rollback() {
  local code=$?
  (( SWAPPED == 1 )) || exit "$code"
  log "更新未完成，尝试恢复上一版本"
  systemctl stop "$SERVICE" >/dev/null 2>&1 || true
  if [[ -e $APP_DIR ]]; then
    FAILED_DIR="${APP_DIR}.failed-${STAMP}"
    mv "$APP_DIR" "$FAILED_DIR" 2>/dev/null || true
    log "失败版本保留在 $FAILED_DIR"
  fi
  if [[ -e $BACKUP_DIR && ! -e $APP_DIR ]]; then
    mv "$BACKUP_DIR" "$APP_DIR" || true
  fi
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl start "$SERVICE" >/dev/null 2>&1 || true
  exit "$code"
}
trap rollback ERR

STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="${APP_DIR}.backup-${STAMP}"
log "从 $REPO_URL ($BRANCH) 下载到临时目录"
clone_with_retry "$REPO_URL" "$BRANCH" "$(dirname "$APP_DIR")" || die "连续 $CLONE_ATTEMPTS 次无法从 GitHub 下载，请稍后重试或设置 SPLENDOR_REPO_URL"

[[ -f "$TEMP_DIR/package.json" && -f "$TEMP_DIR/src/server.js" && -f "$TEMP_DIR/public/index.html" ]] || die "仓库内容不完整，停止切换"
if (( SKIP_TESTS == 0 )); then
  log "运行 Node 语法检查和测试"
  (cd "$TEMP_DIR" && "$NODE_BIN" --check src/server.js && "$NODE_BIN" --check public/app.js && "$NODE_BIN" --test)
fi

if systemctl is-active --quiet "$SERVICE"; then SERVICE_WAS_ACTIVE=1; fi
log "停止 $SERVICE 并切换应用目录"
systemctl stop "$SERVICE"
if [[ -e $APP_DIR ]]; then mv "$APP_DIR" "$BACKUP_DIR"; fi
mv "$TEMP_DIR" "$APP_DIR"
TEMP_DIR=""
SWAPPED=1

if getent passwd "${OWNER%%:*}" >/dev/null 2>&1; then
  chown -R "$OWNER" "$APP_DIR"
else
  log "未找到用户 ${OWNER%%:*}，跳过 chown；可设置 SPLENDOR_OWNER"
fi

# Runtime-created LLM logs must be writable only by the service account.
LOG_DIR="$APP_DIR/data/logs/llm"
install -d -m 0700 -o "${OWNER%%:*}" -g "${OWNER##*:}" "$APP_DIR/data"
install -d -m 0700 -o "${OWNER%%:*}" -g "${OWNER##*:}" "$APP_DIR/data/ai-memory"
install -d -m 0700 -o "${OWNER%%:*}" -g "${OWNER##*:}" "$LOG_DIR"

if (( UPDATE_SERVICE_UNIT == 1 )) && [[ -f "$APP_DIR/deploy/splendor.service" ]]; then
  UNIT_FILE="/etc/systemd/system/${SERVICE}.service"
  if [[ ! -f $UNIT_FILE ]] || ! cmp -s "$APP_DIR/deploy/splendor.service" "$UNIT_FILE"; then
    log "安装更新后的 systemd 服务单元"
    install -m 0644 "$APP_DIR/deploy/splendor.service" "$UNIT_FILE"
    systemctl daemon-reload
  fi
fi

log "启动 $SERVICE"
systemctl start "$SERVICE"
log "检查服务状态和健康接口"
wait_for_health "$SERVICE" "$HEALTH_URL" || die "服务在 ${HEALTH_ATTEMPTS} 次检查后仍未就绪：$HEALTH_URL；请查看 journalctl -u $SERVICE"

log "更新完成：$(cd "$APP_DIR" && git rev-parse --short HEAD)"
log "旧版本备份：$BACKUP_DIR"
log "当前房间保存在内存中，服务重启后会清空。"
trap - ERR
