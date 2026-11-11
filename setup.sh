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
#    Method A: NodeSource apt/dnf repository
#    Method B: official binary from nodejs.org (works on any distro,
#              in containers, and without root) - automatic fallback
# ------------------------------------------------------------------
NODE_DIST_BASE="${NODE_DIST_BASE:-https://nodejs.org/dist}"
NODE_FALLBACK_VERSION="v22.22.3"   # used when the latest version cannot be looked up
SETUP_LOG="$(mktemp /tmp/discordbot-setup.XXXXXX 2>/dev/null || echo /tmp/discordbot-setup.log)"

# Can we run commands as root (either we are root, or sudo works)?
can_root() {
  [ "$(id -u)" -eq 0 ] && return 0
  [ -n "$SUDO" ] && $SUDO true 2>/dev/null
}

# download <url> <output-file>   (curl or wget, whichever exists)
download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    return 127
  fi
}

node_ok() { hash -r; [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; }

# ---- Method A: NodeSource repository ----
install_node_repo() {
  can_root || return 1
  local script="/tmp/nodesource-setup-$$.sh"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -y -qq >>"$SETUP_LOG" 2>&1
    $SUDO apt-get install -y -qq curl ca-certificates gnupg >>"$SETUP_LOG" 2>&1
    # Download to a file first (piping curl straight into bash is what broke before).
    download "https://deb.nodesource.com/setup_${NODE_SETUP_MAJOR}.x" "$script" >>"$SETUP_LOG" 2>&1 || return 1
    $SUDO bash "$script" >>"$SETUP_LOG" 2>&1 || { rm -f "$script"; return 1; }
    rm -f "$script"
    $SUDO apt-get install -y -qq nodejs >>"$SETUP_LOG" 2>&1 || return 1
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    local pkg
    pkg="$(command -v dnf || command -v yum)"
    download "https://rpm.nodesource.com/setup_${NODE_SETUP_MAJOR}.x" "$script" >>"$SETUP_LOG" 2>&1 || return 1
    $SUDO bash "$script" >>"$SETUP_LOG" 2>&1 || { rm -f "$script"; return 1; }
    rm -f "$script"
    $SUDO "$pkg" install -y nodejs >>"$SETUP_LOG" 2>&1 || return 1
  else
    return 1
  fi
  node_ok
}

# ---- Method B: official binary tarball from nodejs.org ----
install_node_binary() {
  local arch version tarball url tmp dest
  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    armv7l)        arch="armv7l" ;;
    *) warn "Unsupported CPU architecture: $(uname -m)"; return 1 ;;
  esac

  # Make sure we have a downloader and tar.
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    can_root && command -v apt-get >/dev/null 2>&1 && $SUDO apt-get install -y -qq curl ca-certificates >>"$SETUP_LOG" 2>&1
  fi
  command -v tar >/dev/null 2>&1 || { warn "'tar' is not installed."; return 1; }

  tmp="$(mktemp -d /tmp/node-install.XXXXXX)" || return 1

  # Look up the newest release of this LTS line; fall back to a pinned version.
  version=""
  if download "${NODE_DIST_BASE}/latest-v${NODE_SETUP_MAJOR}.x/SHASUMS256.txt" "$tmp/sums.txt" >>"$SETUP_LOG" 2>&1; then
    version="$(grep -oE "node-v[0-9]+\.[0-9]+\.[0-9]+-linux-${arch}\.tar\.gz" "$tmp/sums.txt" | head -n 1 | sed -E 's/^node-(v[0-9.]+)-.*/\1/')"
  fi
  version="${version:-$NODE_FALLBACK_VERSION}"

  tarball="node-${version}-linux-${arch}.tar.gz"
  url="${NODE_DIST_BASE}/${version}/${tarball}"
  echo "   Downloading Node.js ${version} (${arch})..."
  if ! download "$url" "$tmp/$tarball" >>"$SETUP_LOG" 2>&1; then
    warn "Download failed: $url"
    rm -rf "$tmp"; return 1
  fi

  # Verify the checksum when we have the list and sha256sum.
  if [ -s "$tmp/sums.txt" ] && command -v sha256sum >/dev/null 2>&1 && grep -q " ${tarball}\$" "$tmp/sums.txt"; then
    if ! ( cd "$tmp" && grep " ${tarball}\$" sums.txt | sha256sum -c - >>"$SETUP_LOG" 2>&1 ); then
      warn "Checksum of the Node.js download does not match."
      rm -rf "$tmp"; return 1
    fi
  fi

  if can_root; then
    # System-wide: /usr/local/bin/node, /usr/local/lib/node_modules/npm ...
    $SUDO tar -xzf "$tmp/$tarball" -C /usr/local --strip-components=1 --no-same-owner \
      --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE' >>"$SETUP_LOG" 2>&1 \
      || { rm -rf "$tmp"; return 1; }
    case ":$PATH:" in *":/usr/local/bin:"*) ;; *) export PATH="/usr/local/bin:$PATH" ;; esac
  else
    # No root: install into the home directory and add it to the PATH.
    dest="$HOME/.local/node"
    rm -rf "$dest" && mkdir -p "$dest" || { rm -rf "$tmp"; return 1; }
    tar -xzf "$tmp/$tarball" -C "$dest" --strip-components=1 >>"$SETUP_LOG" 2>&1 || { rm -rf "$tmp"; return 1; }
    export PATH="$dest/bin:$PATH"
    for rc in "$HOME/.bashrc" "$HOME/.profile"; do
      grep -qs '.local/node/bin' "$rc" || printf '\n# Node.js (added by Discord bot setup)\nexport PATH="$HOME/.local/node/bin:$PATH"\n' >> "$rc"
    done
    warn "No root access: Node.js was installed to $dest (open a new terminal later to use node/pm2 directly)."
  fi
  rm -rf "$tmp"
  node_ok
}

# A previous run may have installed Node.js into the home directory already.
[ -x "$HOME/.local/node/bin/node" ] && export PATH="$HOME/.local/node/bin:$PATH"

info "Checking Node.js (v${MIN_NODE_MAJOR}+ required)..."
if node_ok; then
  ok "Node.js $(node -v) found."
else
  warn "Node.js v${MIN_NODE_MAJOR}+ not found. Installing Node.js ${NODE_SETUP_MAJOR} LTS silently..."
  if install_node_repo; then
    :
  else
    warn "Package repository method did not work. Trying the official Node.js binary instead..."
    if ! install_node_binary; then
      echo "------ last lines of $SETUP_LOG ------" >&2
      tail -n 15 "$SETUP_LOG" >&2 2>/dev/null
      die "Could not install Node.js automatically. Install Node.js ${NODE_SETUP_MAJOR} manually (https://nodejs.org) and run ./setup.sh again."
    fi
  fi
  ok "Node.js $(node -v) installed."
fi
command -v npm >/dev/null 2>&1 || die "npm was not found. Please reinstall Node.js."

# ------------------------------------------------------------------
# 2. Dependencies
# ------------------------------------------------------------------
info "Installing dependencies (npm install)..."
npm install --omit=dev --no-audit --no-fund || die "npm install failed."
ok "Dependencies installed."

# FFmpeg is needed by /music. It normally comes with the ffmpeg-static package;
# if that download failed, fall back to the system package (best effort).
if ! node -e 'const f=require("ffmpeg-static");process.exit(f&&require("fs").existsSync(f)?0:1)' >/dev/null 2>&1 \
   && ! command -v ffmpeg >/dev/null 2>&1; then
  warn "Bundled FFmpeg is not available. Installing the system FFmpeg package for /music..."
  if can_root && command -v apt-get >/dev/null 2>&1 && $SUDO apt-get install -y -qq ffmpeg >>"$SETUP_LOG" 2>&1; then
    ok "FFmpeg installed."
  else
    warn "Could not install FFmpeg. /music will not work until you run:  sudo apt install -y ffmpeg"
  fi
fi

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
if [ ! -d /run/systemd/system ]; then
  # Containers and some cheap VPS panels have no systemd, so there is nothing to register with.
  warn "This machine does not use systemd, so auto-start on reboot cannot be registered."
  warn "After a reboot / container restart, bring the bot back with:  pm2 resurrect"
elif $SUDO env "PATH=$PATH:$NODE_BIN_DIR" "$(command -v pm2)" startup systemd -u "$RUN_USER" --hp "$RUN_HOME" >/dev/null 2>&1; then
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
