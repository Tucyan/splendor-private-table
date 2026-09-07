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

for command in git systemctl curl mktemp mv date cmp install grep getent; do
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
TEMP_DIR="$(mktemp -d "$(dirname "$APP_DIR")/.splendor-update.XXXXXX")"
BACKUP_DIR="${APP_DIR}.backup-${STAMP}"
log "从 $REPO_URL ($BRANCH) 下载到临时目录"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TEMP_DIR"

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
systemctl is-active --quiet "$SERVICE" || die "$SERVICE 未处于 active 状态，请查看 journalctl -u $SERVICE"
curl --fail --silent --show-error --max-time 15 "$HEALTH_URL" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' || die "健康检查失败：$HEALTH_URL"

log "更新完成：$(cd "$APP_DIR" && git rev-parse --short HEAD)"
log "旧版本备份：$BACKUP_DIR"
log "当前房间保存在内存中，服务重启后会清空。"
trap - ERR
