#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  DULMS Watcher v14.0 — VPS Deployment (Oracle Cloud Free Tier)
#  ═══════════════════════════════════════════════════════════════════════════
#  Requirements:
#    - Ubuntu 22.04+ (Oracle Cloud Ubuntu image)
#    - sudo access
#    - 1GB+ RAM (E2.1.Micro)
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/YOUR_USER/dulms-watcher.git}"
INSTALL_DIR="/opt/dulms-watcher"
ENV_FILE="/etc/dulms-watcher.env"
LOG_FILE="/var/log/dulms-watcher.log"
SERVICE_NAME="dulms-watcher"
NODE_VERSION="22"

# ─── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️${NC}  $*"; }
err()  { echo -e "${RED}❌${NC} $*" >&2; }

# ═══════════════════════════════════════════════════════════════════════
#  STEP 0 — Banner
# ═══════════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DULMS Watcher v14.0 — VPS Deployment"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════
#  STEP 1 — Pre-flight checks
# ═══════════════════════════════════════════════════════════════════════
log "Pre-flight checks…"

if [ "$EUID" -eq 0 ]; then
  warn "Running as root — will install system-wide"
fi

if ! command -v sudo >/dev/null && [ "$EUID" -ne 0 ]; then
  err "sudo is required"
  exit 1
fi

MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [ "$MEM_MB" -lt 800 ]; then
  warn "Only ${MEM_MB}MB RAM — Playwright may struggle"
fi

log "Memory: ${MEM_MB}MB | Disk: $(df -h / | awk 'NR==2{print $4}') free"
ok "Pre-flight passed"

# ═══════════════════════════════════════════════════════════════════════
#  STEP 2 — System dependencies
# ═══════════════════════════════════════════════════════════════════════
log "Installing system dependencies…"

sudo apt-get update -qq
sudo apt-get install -y -qq \
  curl git build-essential ca-certificates gnupg \
  logrotate htop jq

# ─── Node.js ───────────────────────────────────────────────────────────
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  log "Installing Node.js ${NODE_VERSION}…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | sudo -E bash - >/dev/null 2>&1
  sudo apt-get install -y -qq nodejs
fi

ok "Node.js $(node -v) | npm $(npm -v)"

# ═══════════════════════════════════════════════════════════════════════
#  STEP 3 — Clone repository
# ═══════════════════════════════════════════════════════════════════════
log "Setting up ${INSTALL_DIR}…"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Repo exists — pulling latest…"
  sudo git -C "$INSTALL_DIR" fetch --all
  sudo git -C "$INSTALL_DIR" reset --hard origin/main
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
sudo chown -R "$USER:$USER" "$INSTALL_DIR"

# ═══════════════════════════════════════════════════════════════════════
#  STEP 4 — npm packages + Playwright
# ═══════════════════════════════════════════════════════════════════════
log "Installing npm dependencies…"
npm install --production --no-audit --no-fund

log "Installing Playwright Chromium (may take 2-3 min)…"
npx playwright install chromium --with-deps

ok "Dependencies installed"

# ═══════════════════════════════════════════════════════════════════════
#  STEP 5 — Environment file
# ═══════════════════════════════════════════════════════════════════════
if [ ! -f "$ENV_FILE" ]; then
  log "Creating ${ENV_FILE}…"

  GENERATED_KEY=$(openssl rand -hex 32)

  sudo tee "$ENV_FILE" > /dev/null <<EOF
# ═══════════════════════════════════════════════════════════════════════
#  DULMS Watcher v14.0 — Environment
# ═══════════════════════════════════════════════════════════════════════
#  ⚠️  Fill in the blanks, then: sudo systemctl restart dulms-watcher
# ═══════════════════════════════════════════════════════════════════════

# ─── DULMS Credentials ─────────────────────────────────────────────────
DULMS_USERNAME=CHANGE_ME
DULMS_PASSWORD=CHANGE_ME

# ─── Telegram ──────────────────────────────────────────────────────────
TG_TOKEN=CHANGE_ME
TG_CHAT_ID=CHANGE_ME

# ─── Encryption (auto-generated) ───────────────────────────────────────
STATE_ENCRYPTION_KEY=${GENERATED_KEY}

# ─── Runtime ───────────────────────────────────────────────────────────
NODE_ENV=production
DURATION_MIN=999999
NODE_OPTIONS=--max-old-space-size=768
EOF

  sudo chmod 600 "$ENV_FILE"
  sudo chown root:root "$ENV_FILE"

  warn "⚠️  Edit ${ENV_FILE} with real credentials BEFORE starting"
  warn "   Generated STATE_ENCRYPTION_KEY: ${GENERATED_KEY:0:16}…"
else
  log "Env file exists — skipping"
fi

# ═══════════════════════════════════════════════════════════════════════
#  STEP 6 — Systemd service
# ═══════════════════════════════════════════════════════════════════════
log "Installing systemd service…"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<EOF
[Unit]
Description=DULMS Watcher v14.0 Monolith
Documentation=https://github.com/YOUR_USER/dulms-watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node watch.js
Restart=always
RestartSec=30
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
SyslogIdentifier=dulms-watcher

# ─── Resource limits ───────────────────────────────────────────────────
LimitNOFILE=65536
MemoryMax=900M
MemoryHigh=700M

# ─── Security hardening ────────────────────────────────────────────────
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR} /var/log
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

# ═══════════════════════════════════════════════════════════════════════
#  STEP 7 — Logrotate
# ═══════════════════════════════════════════════════════════════════════
log "Configuring logrotate…"

sudo tee "/etc/logrotate.d/${SERVICE_NAME}" > /dev/null <<EOF
${LOG_FILE} {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
    copytruncate
}
EOF

# ═══════════════════════════════════════════════════════════════════════
#  STEP 8 — Enable + start
# ═══════════════════════════════════════════════════════════════════════
log "Enabling + starting service…"

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

if grep -q "CHANGE_ME" "$ENV_FILE"; then
  warn "⚠️  Env file still contains CHANGE_ME — service NOT started"
  warn "    Edit: sudo nano ${ENV_FILE}"
  warn "    Then: sudo systemctl start ${SERVICE_NAME}"
  exit 0
fi

sudo systemctl start "$SERVICE_NAME"
sleep 3

# ═══════════════════════════════════════════════════════════════════════
#  STEP 9 — Verify
# ═══════════════════════════════════════════════════════════════════════
log "Verifying service…"

if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "Service is RUNNING"
else
  err "Service FAILED — check logs:"
  sudo journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════
#  DONE
# ═══════════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ DULMS Watcher v14.0 deployed successfully!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  📋 Useful commands:"
echo ""
echo "    Status:      sudo systemctl status dulms-watcher"
echo "    Logs (live): sudo journalctl -u dulms-watcher -f"
echo "    Logs (file): sudo tail -f ${LOG_FILE}"
echo "    Restart:     sudo systemctl restart dulms-watcher"
echo "    Stop:        sudo systemctl stop dulms-watcher"
echo "    Edit env:    sudo nano ${ENV_FILE}"
echo ""
echo "  🔐 Encrypted files:"
echo "    ${INSTALL_DIR}/.dulms-state.json"
echo "    ${INSTALL_DIR}/.dulms-session.json"
echo ""
echo "  💡 Next: open Telegram and send /status"
echo ""
