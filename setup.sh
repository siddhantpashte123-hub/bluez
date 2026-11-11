#!/usr/bin/env bash
# ==================================================================
#  ONE-CLICK SETUP  -  Linux VPS (Ubuntu / Debian)
#
#  Usage:   chmod +x setup.sh && ./setup.sh
#
#  1. Installs Node.js LTS if Node.js v20+ is missing
#  2. Runs npm install
#  3. Asks for the bot token and saves it to .env
#  4. Installs PM2, starts the bot, enables start-on-boot
#
#  No Docker is used anywhere.
# ==================================================================
set -u

APP_NAME="DiscordBot"
NODE_SETUP_MAJOR="22"   # LTS line installed when Node.js is missing/too old
MIN_NODE_MAJOR=20

cd "$(dirname "$(readlink -f "$0")")" || exit 1

info() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# sudo only when we are not root
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
  warn "Not running as root and 'sudo' is not installed. System-wide installs may fail."
fi

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

# ------------------------------------------------------------------
# 1. Node.js
# ------------------------------------------------------------------
info "Checking Node.js (v${MIN_NODE_MAJOR}+ required)..."
if [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
  ok "Node.js $(node -v) found."
else
  warn "Node.js v${MIN_NODE_MAJOR}+ not found. Installing Node.js ${NODE_SETUP_MAJOR} LTS silently..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -y -qq >/dev/null || die "apt-get update failed."
    $SUDO apt-get install -y -qq curl ca-certificates gnupg >/dev/null || die "Could not install curl."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_SETUP_MAJOR}.x" | $SUDO -E bash - >/dev/null 2>&1 \
      || die "Could not add the NodeSource repository."
    $SUDO apt-get install -y -qq nodejs >/dev/null || die "Could not install Node.js."
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    PKG="$(command -v dnf || command -v yum)"
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_SETUP_MAJOR}.x" | $SUDO bash - >/dev/null 2>&1 \
      || die "Could not add the NodeSource repository."
    $SUDO "$PKG" install -y nodejs >/dev/null || die "Could not install Node.js."
  else
    die "Unsupported Linux distribution. Please install Node.js ${NODE_SETUP_MAJOR} manually: https://nodejs.org"
  fi
  hash -r
  [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null || die "Node.js installation failed."
  ok "Node.js $(node -v) installed."
fi
command -v npm >/dev/null 2>&1 || die "npm was not found. Please reinstall Node.js."

# ------------------------------------------------------------------
# 2. Dependencies
# ------------------------------------------------------------------
info "Installing dependencies (npm install)..."
npm install --omit=dev --no-audit --no-fund || die "npm install failed."
ok "Dependencies installed."

# ------------------------------------------------------------------
# 3. Bot token -> .env   (the token is never printed or logged)
# ------------------------------------------------------------------
info "Bot token"
KEEP="n"
if [ -f .env ] && grep -Eq '^DISCORD_TOKEN=.+' .env && ! grep -q '^DISCORD_TOKEN=your-bot-token-here' .env; then
  read -r -p "A token is already saved. Keep it? [Y/n]: " KEEP || KEEP="y"
  KEEP="${KEEP:-y}"
fi

case "$KEEP" in
  y|Y|yes|YES)
    ok "Keeping the existing token."
    ;;
  *)
    TOKEN=""
    while [ -z "$TOKEN" ]; do
      read -r -p "Paste your Discord Bot Token: " TOKEN || die "No token provided."
      TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]"'"'")"   # strip spaces / quotes
      [ -z "$TOKEN" ] && warn "The token cannot be empty."
    done
    ( umask 077; printf 'DISCORD_TOKEN=%s\n' "$TOKEN" > .env )
    chmod 600 .env
    unset TOKEN
    ok "Token saved to .env"
    ;;
esac

# ------------------------------------------------------------------
# 4. PM2  (24/7 uptime + auto-start on reboot)
# ------------------------------------------------------------------
info "Installing PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 --no-audit --no-fund >/dev/null 2>&1 \
    || $SUDO npm install -g pm2 --no-audit --no-fund >/dev/null \
    || die "Could not install PM2."
  hash -r
fi
command -v pm2 >/dev/null 2>&1 || die "PM2 was installed but is not on the PATH."
ok "PM2 $(pm2 -v 2>/dev/null | tail -n 1) ready."

info "Starting the bot with PM2..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
# --exp-backoff-restart-delay: if the bot ever crashes, wait longer and longer
# between restarts instead of hammering Discord.
pm2 start index.js --name "$APP_NAME" --time --exp-backoff-restart-delay 2000 || die "PM2 could not start the bot."
pm2 save >/dev/null || warn "pm2 save failed."

# Give the bot a few seconds, then make sure it is not crash-looping (e.g. wrong token).
sleep 8
RESTARTS="$(pm2 jlist 2>/dev/null | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      const p = JSON.parse(s.slice(s.indexOf("["))).find((x) => x.name === process.argv[1]);
      console.log(p ? p.pm2_env.restart_time : 0);
    } catch { console.log(0); }
  });' "$APP_NAME" 2>/dev/null)"
if [ "${RESTARTS:-0}" -gt 0 ] 2>/dev/null; then
  warn "The bot keeps restarting. The token is probably wrong, or the privileged intents are disabled."
  warn "Check the reason with:  pm2 logs $APP_NAME --lines 20"
  warn "Then fix it and run ./setup.sh again."
  exit 1
fi

info "Enabling auto-start on reboot (pm2 startup)..."
RUN_USER="$(id -un)"
RUN_HOME="${HOME:-$(getent passwd "$RUN_USER" | cut -d: -f6)}"
NODE_BIN_DIR="$(dirname "$(command -v node)")"
if $SUDO env "PATH=$PATH:$NODE_BIN_DIR" "$(command -v pm2)" startup systemd -u "$RUN_USER" --hp "$RUN_HOME" >/dev/null 2>&1; then
  pm2 save >/dev/null 2>&1
  ok "The bot will start automatically after a reboot."
else
  warn "Could not register the startup service automatically. Run 'pm2 startup' and follow its instructions."
fi

printf '\n\033[1;32m✅ Bot is now running 24/7. Token saved. Done.\033[0m\n\n'
echo "   Logs:     pm2 logs $APP_NAME"
echo "   Restart:  pm2 restart $APP_NAME"
echo "   Stop:     pm2 stop $APP_NAME"
echo
