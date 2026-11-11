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
| 🔊 Voice | `/247 vc join <voice_channel>` | Join a voice channel and stay there 24/7 with auto-reconnect |
| | `/247 vc stop` | Leave and turn 24/7 mode off |
| 🤖 Automation | `/autoresponder set / remove / list` | Auto-reply to keywords (needs **Manage Server**) |
| | `/auto reacter set / remove / list` | Auto-react to keywords, custom emojis supported (needs **Manage Server**) |
| 🎵 Music | `/music play <song>` | Play a song by name or link, or add it to the queue |
| | `/music pause / resume / skip / stop` | Playback controls (also available as buttons) |
| | `/music queue / nowplaying / shuffle / loop` | Queue tools and repeat modes |
| 🎁 Giveaways | `/gcreate <prize> <duration> [winners] [channel]` | Start a giveaway with an **Enter** button (needs **Manage Server**) |
| | `/gend [message_id]` | End a giveaway now and pick the winner(s) |
| | `/greroll [message_id] [winners]` | Pick new winner(s) for an ended giveaway |
| 🎫 Tickets | `/ticket setup [channel] [category] [support_role]` | Post the ticket panel with a **Create Ticket** button (needs **Manage Server**) |
| | `/ticket close` | Close the ticket you are in (owner or support team) |
| | `/ticket add / remove <user>` | Add or remove a member from the current ticket (support team) |
| 📊 Info | `/invites` | Invite leaderboard, top 10 with 🥇🥈🥉 |
| | `/invited <user>` | A member's invite count and invite codes |
| | `/userinfo [user]` | A member's profile: ID, join date, roles |
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
   Use External Emojis, Manage Messages, Manage Channels, Manage Roles, Manage Server, Create Invite, Connect, Speak.
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

1. Check for **Node.js v20+** and silently install Node.js LTS if it is missing (Linux: package repository first, official nodejs.org binary as automatic fallback).
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
│   ├── gcreate.js           # giveaways (+ gend.js, greroll.js)
│   ├── gend.js
│   ├── greroll.js
│   ├── music.js
│   ├── upiqr.js
│   ├── help.js
│   ├── afk.js
│   ├── 247vc.js
│   ├── channelrename.js
│   ├── autoresponder.js
│   ├── autoreacter.js
│   ├── ticket.js
│   └── userinfo.js
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
    ├── 247vc.json
    ├── giveaways.json
    └── tickets.json
```

---

## 🎁 Giveaways

- `/gcreate prize:Nitro duration:1d12h winners:2` posts the giveaway. Durations use `s`, `m`, `h`, `d`, `w` (10 seconds to 30 days).
- Members press **Enter Giveaway** to join and press it again to leave.
- When the time is up the bot picks random winners, edits the message and pings them. This also works if the bot was restarted in between.
- `/gend` ends a giveaway early. `/greroll` picks new winners; ended giveaways can be rerolled for 7 days.
- Without a `message_id`, `/gend` and `/greroll` use the newest giveaway in the current channel.

## 🎵 Music

- Join a voice channel and run `/music play song:<name or link>`. Song names are searched on YouTube first and on SoundCloud as a backup. Direct links work for the sites supported by yt-dlp.
- The "Now Playing" message has buttons for pause, skip, loop, queue and stop. You must be in the bot's voice channel to use them.
- The bot leaves 3 minutes after the queue ends. If 24/7 mode is on, music plays in the 24/7 channel and the bot stays there afterwards.
- **yt-dlp** is downloaded automatically into `bin/` the first time a song is played, and refreshed weekly. **FFmpeg** comes from the `ffmpeg-static` package; if that is missing, install it with `sudo apt install -y ffmpeg`.
- Playlists are not supported; a playlist link plays only the linked song.
- YouTube often blocks requests from VPS / datacenter IP addresses ("Sign in to confirm you're not a bot"). If that happens, song names fall back to SoundCloud, and SoundCloud links keep working.

## 🎫 Ticket system

1. Give the bot's role **Manage Channels** and **Manage Roles** (or Administrator).
2. Run `/ticket setup`. All options are optional:
   - `channel`: where the panel is posted (default: the current channel)
   - `category`: where ticket channels are created
   - `support_role`: the role that can see and answer every ticket
3. Members press **Create Ticket**. The bot creates a private channel that only the member, the support role and the bot can see.
4. Close a ticket with the **Close Ticket** button or `/ticket close`. The channel is deleted 5 seconds after confirming.

Each member can have one open ticket. The panel button keeps working after a bot restart.

## 😀 Custom emojis

The bot uses five custom emojis (tick, caution, two gifts, bow). Their IDs are listed at the top of `utils/embeds.js`.

- Upload them under **Developer Portal → your application → Emojis**, for the **same application** whose token the bot uses. Emojis from a server the bot is in also work.
- On startup the log shows `Custom emojis loaded: 5/5`. Any emoji that cannot be found is replaced by a normal emoji (✅ ⚠️ 🎁 🎀), so nothing breaks.
- To add or change one, edit the `EMOJIS` list in `utils/embeds.js` and use it in code with `embeds.e('key')`.

## 📝 Good to know

- **`/24/7 vc` is typed as `/247 vc join` and `/247 vc stop`.** Discord does not allow `/` or spaces inside a command name, and a command cannot have a channel option and a subcommand at the same level.
- **24/7 voice** plays a looped silent track. With Node.js 22.12+ and a working `ffmpeg-static` binary it uses `discord-audio-stream`; otherwise it falls back automatically to a built-in silent Opus stream from `@discordjs/voice`. Saved channels are rejoined on startup, on disconnect, and by a 60-second watchdog.
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
