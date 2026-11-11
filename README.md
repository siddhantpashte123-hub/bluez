# 🤖 Premium Discord Bot

A feature-rich Discord bot built with **Node.js + discord.js v14**. Slash commands only, premium embeds everywhere, JSON file storage, and a one-click installer.

> **No Docker.** The bot runs natively (`node index.js` / `npm start`) and is kept online 24/7 by **PM2**.

---

## ✨ Features

| Category | Command | What it does |
| --- | --- | --- |
| 🛡️ Moderation | `/purge <amount>` | Bulk delete up to 100 messages (needs **Manage Messages**) |
| | `/channel rename <new_name>` | Rename the current channel (needs **Manage Channels**) |
| | `/dm <user> <message>` | DM one member through the bot (needs **Manage Server**) |
| | `/dmall <message>` | DM every member with a live progress embed (needs **Administrator**) |
| 🧰 Utility | `/upiqr <upi_id> <amount> <name>` | UPI payment QR. Amounts above ₹2,000 are split into several QR codes |
| | `/afk <reason>` | Set AFK. The bot replies when you are pinged and clears AFK when you talk |
| | `/gcreate <name>` | Create a new server owned by the bot (needs **Administrator**) |
| 🔊 Voice | `/247 vc join <voice_channel>` | Join a voice channel and stay there 24/7 with auto-reconnect |
| | `/247 vc stop` | Leave and turn 24/7 mode off |
| 🤖 Automation | `/autoresponder set / remove / list` | Auto-reply to keywords (needs **Manage Server**) |
| | `/auto reacter set / remove / list` | Auto-react to keywords, custom emojis supported (needs **Manage Server**) |
| 📊 Info | `/invites` | Invite leaderboard, top 10 with 🥇🥈🥉 |
| | `/invited <user>` | A member's invite count and invite codes |
| | `/help` | Multi-page help menu with button navigation |

---

## 1️⃣ Create the bot and get the token

1. Open the **[Discord Developer Portal](https://discord.com/developers/applications)** and log in.
2. Click **New Application**, give it a name, and click **Create**.
3. Open the **Bot** tab on the left.
4. Click **Reset Token** → **Yes, do it!** → **Copy**. This is your **bot token**.
   Keep it secret. Anyone who has it controls your bot. If it leaks, press **Reset Token** again.

## 2️⃣ Enable the privileged intents (required)

Still on the **Bot** tab, scroll to **Privileged Gateway Intents** and switch **ON**:

| Intent | Needed for |
| --- | --- |
| ✅ **MESSAGE CONTENT INTENT** | Autoresponder, auto reacter and AFK (the bot must read messages) |
| ✅ **SERVER MEMBERS INTENT** | `/dmall` and invite tracking |

Click **Save Changes**. Without these the bot will refuse to start (`Used disallowed intents`).

## 3️⃣ Invite the bot to your server

1. Open **OAuth2 → URL Generator**.
2. Scopes: tick **`bot`** and **`applications.commands`**.
3. Bot permissions: tick **Administrator** (simplest), or at least:
   View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions,
   Use External Emojis, Manage Messages, Manage Channels, Manage Server, Create Invite, Connect, Speak.
4. Open the generated URL and add the bot to your server.

## 4️⃣ One-click setup

Copy the project folder to your VPS, then:

### 🪟 Windows VPS

Double-click **`setup.bat`**.

### 🐧 Linux VPS (Ubuntu / Debian)

```bash
chmod +x setup.sh
./setup.sh
```

Both scripts do the same thing, automatically:

1. Check for **Node.js v20+** and silently install Node.js LTS if it is missing.
2. Run `npm install`.
3. Ask: `Paste your Discord Bot Token:` and save it to `.env` as `DISCORD_TOKEN=...`.
4. Install **PM2**, start the bot as `DiscordBot`, run `pm2 save`, and register auto-start on reboot.
5. Print `✅ Bot is now running 24/7. Token saved. Done.`

That is it. Type `/help` in your server.

> Slash commands are registered **globally**. The first time, Discord can take a few minutes to show them. Restart your Discord app (Ctrl+R) if they do not appear.

---

## 🔁 Managing the bot with PM2

```bash
pm2 status                 # is it online?
pm2 logs DiscordBot        # live logs (Ctrl+C to exit)
pm2 restart DiscordBot     # restart
pm2 stop DiscordBot        # stop
pm2 start DiscordBot       # start again
pm2 delete DiscordBot      # remove from PM2
```

### Updating the bot

```bash
# 1. Replace the code (git pull, or copy the new files over the old ones).
#    Keep your .env file and your data/ folder!
git pull

# 2. Install any new dependencies
npm install

# 3. Restart
pm2 restart DiscordBot
```

### Changing the token

Run the setup script again and answer **n** when asked to keep the existing token,
or edit `.env` by hand and run `pm2 restart DiscordBot`.

### Running without PM2 (for testing)

```bash
npm start      # same as: node index.js
```

---

## 📂 Project structure

```
/
├── index.js                 # entry point: client, loaders, login
├── .env.example             # template for the token file
├── package.json
├── setup.bat                # one-click setup (Windows)
├── setup.sh                 # one-click setup (Linux)
├── README.md
├── commands/
│   ├── dm.js
│   ├── dmall.js
│   ├── purge.js
│   ├── invites.js
│   ├── invited.js
│   ├── gcreate.js
│   ├── upiqr.js
│   ├── help.js
│   ├── afk.js
│   ├── 247vc.js
│   ├── channelrename.js
│   ├── autoresponder.js
│   └── autoreacter.js
├── events/
│   ├── ready.js             # registers commands, invite sync, rejoins 24/7 VCs
│   ├── interactionCreate.js # command router + error embeds
│   ├── messageCreate.js     # AFK, autoresponder, auto reacter
│   └── voiceStateUpdate.js  # 24/7 VC auto-reconnect
├── utils/
│   ├── embeds.js            # shared premium embed builder
│   └── db.js                # tiny JSON database
└── data/                    # per-server storage (back this folder up)
    ├── autoresponder.json
    ├── reacter.json
    ├── afk.json
    ├── invites.json
    └── 247vc.json
```

---

## 📝 Good to know

- **`/24/7 vc` is typed as `/247 vc join` and `/247 vc stop`.** Discord does not allow `/` or spaces inside a command name, and a command cannot have a channel option and a subcommand at the same level.
- **24/7 voice** plays a looped silent track. With Node.js 22.12+ and a working `ffmpeg-static` binary it uses `discord-audio-stream`; otherwise it falls back automatically to a built-in silent Opus stream from `@discordjs/voice`. Saved channels are rejoined on startup, on disconnect, and by a 60-second watchdog.
- **`/gcreate`**: Discord only lets bots create servers while they are in fewer than 10 servers, and has been restricting this endpoint for apps. If Discord refuses, the bot shows a clear error embed.
- **`/dmall`** sends one DM every 1.5 seconds and skips bots. Members with closed DMs are counted as failed. Discord treats unsolicited mass DMs as spam and can quarantine or ban bots that abuse this, so use it only for real announcements in your own server.
- **`/upiqr`**: Discord embeds cannot make `upi://` links clickable, so the "Pay Now" link is shown as copyable text next to the QR code. Maximum amount is ₹50,000 per command.
- **`/invites`** needs the bot to have **Manage Server** to read invite links. Counts are saved in `data/invites.json`, so they survive deleted or expired links.
- **`/channel rename`**: Discord allows only 2 renames per channel every 10 minutes.
- The token is read only from `.env`. It is never hard-coded and never written to the logs. `.env` is in `.gitignore`.

## 🛠️ Troubleshooting

| Problem | Fix |
| --- | --- |
| `Used disallowed intents` in the logs | Enable both privileged intents (step 2) and run `pm2 restart DiscordBot` |
| `Discord rejected the token` | Reset the token in the Developer Portal and run the setup script again |
| Slash commands do not show up | Wait a few minutes, restart Discord, and make sure the invite used the `applications.commands` scope |
| Autoresponder / AFK does nothing | Message Content Intent is off, or the bot cannot send messages in that channel |
| Bot does not join the voice channel | Give it **View Channel** and **Connect** in that channel |
| `pm2` is not recognised (Windows) | Close the window and open a new terminal so the updated PATH is loaded |
