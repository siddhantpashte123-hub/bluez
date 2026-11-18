# 📚 Bot Commands

All registered slash commands and their options. `<option>` is required; `[option]` is optional. Discord shows the option names and choices when you type a command.

Most commands also support the `!` prefix, for example `!calc 1+1`. Sensitive commands are slash-only because prefix messages are public. Administrative and staff commands still require the appropriate permissions. `/help` offers an interactive guide.

## /247

| Command | Description |
| --- | --- |
| `/247 vc join <voice_channel>` | 🔊 Join a voice channel and stay connected 24/7. |
| `/247 vc stop` | ⏹️ Leave the voice channel and turn 24/7 mode off. |

## /afk

| Command | Description |
| --- | --- |
| `/afk <reason>` | 💤 Set your AFK status. I will let people know when they ping you. |

## /announce

| Command | Description |
| --- | --- |
| `/announce <message> [title] [channel] [ping] [role] [image] [color]` | 📢 Post an announcement (with optional ping). |

## /antiraid

| Command | Description |
| --- | --- |
| `/antiraid set <enabled> [min_account_age_days] [join_limit]` | 🛡️ Turn raid protection on or off. |
| `/antiraid status` | 📋 Show the raid protection settings. |

## /audit

| Command | Description |
| --- | --- |
| `/audit` | View recent supported bot configuration changes (admin). |

## /auto

| Command | Description |
| --- | --- |
| `/auto reacter set <trigger> <emoji>` | ➕ Add or update an auto-reaction. |
| `/auto reacter remove <trigger>` | ➖ Remove an auto-reaction. |
| `/auto reacter list` | 📜 List all auto-reactions of this server. |

## /automod

| Command | Description |
| --- | --- |
| `/automod set <rule> <enabled>` | ⚙️ Turn an automod rule on or off. |
| `/automod word <action> <word>` | 🚫 Add or remove a blocked word. |
| `/automod status` | 📊 Show the automod settings. |

## /autoresponder

| Command | Description |
| --- | --- |
| `/autoresponder set <trigger> <response>` | ➕ Add or update an auto-response. |
| `/autoresponder remove <trigger>` | ➖ Remove an auto-response. |
| `/autoresponder list` | 📜 List all auto-responses of this server. |

## /backup

| Command | Description |
| --- | --- |
| `/backup upload` | Replace channels using a secret backup code (destructive). |
| `/backup export` | Download a private JSON snapshot of roles and channels. |
| `/backup restore <snapshot>` | Preview a safe additive roles/channels restore (administrator). |

## /birthday

| Command | Description |
| --- | --- |
| `/birthday set <day> <month>` | 🎂 Save your birthday. |
| `/birthday remove` | 🗑️ Delete your birthday. |
| `/birthday list` | 📜 Upcoming birthdays. |
| `/birthday channel <channel>` | ⚙️ Choose where birthdays are announced (admins). |

## /branding

| Command | Description |
| --- | --- |
| `/branding set [color] [name] [footer]` | Set branding fields; omitted fields stay unchanged. |
| `/branding reset` | Reset branding to defaults. |

## /calc

| Command | Description |
| --- | --- |
| `/calc <expression>` | 🧮 Calculator. |

## /channel

| Command | Description |
| --- | --- |
| `/channel rename <new_name>` | ✏️ Rename the current channel. |

## /dm

| Command | Description |
| --- | --- |
| `/dm <user> <message>` | 📨 Send a direct message to a member through the bot. |

## /dmall

| Command | Description |
| --- | --- |
| `/dmall <message>` | 📢 Send a DM announcement to every member of this server. |

## /eco

| Command | Description |
| --- | --- |
| `/eco balance [user]` | 🪙 Show your coins. |
| `/eco daily` | 🎁 Collect your daily coins. |
| `/eco work` | 💼 Work for coins (once per hour). |
| `/eco pay <user> <amount>` | 💸 Give coins to another member. |
| `/eco leaderboard` | 🏆 Richest members. |

## /embed

| Command | Description |
| --- | --- |
| `/embed <title> <description> [color] [image] [thumbnail] [footer] [channel]` | 📝 Send a custom embed / announcement. |

## /faq

| Command | Description |
| --- | --- |
| `/faq set <key> <answer>` | Create or update a public answer (Manage Server). |
| `/faq remove <key>` | Remove an FAQ (Manage Server). |
| `/faq list` | List FAQ keys. |
| `/faq view <key>` | Show a public FAQ answer. |

## /fun

| Command | Description |
| --- | --- |
| `/fun 8ball <question>` | 🎱 Ask the magic 8-ball. |
| `/fun coinflip` | 🪙 Flip a coin. |
| `/fun dice [sides]` | 🎲 Roll a dice. |
| `/fun choose <options>` | 🤔 Let me choose for you. |

## /gcreate

| Command | Description |
| --- | --- |
| `/gcreate <prize> <duration> [winners] [channel] [required_role] [min_invites] [bonus_role]` | 🎁 Start a giveaway. |

## /gend

| Command | Description |
| --- | --- |
| `/gend [message_id]` | 🏁 End a giveaway now and pick the winner(s). |

## /greroll

| Command | Description |
| --- | --- |
| `/greroll [message_id] [winners]` | 🔄 Pick new winner(s) for an ended giveaway. |

## /health

| Command | Description |
| --- | --- |
| `/health` | Private bot health overview (administrator). |

## /help

| Command | Description |
| --- | --- |
| `/help` | ✨ Open the interactive help menu. |

## /info

| Command | Description |
| --- | --- |
| `/info server` | 🏠 Information about this server. |
| `/info avatar [user]` | 🖼️ Show the avatar of a member. |
| `/info ping` | 🏓 Check how fast the bot responds. |
| `/info bot` | 🤖 Information about the bot. |

## /invited

| Command | Description |
| --- | --- |
| `/invited <user>` | 🔗 Show a member's invite count and invite codes. |

## /inviterewards

| Command | Description |
| --- | --- |
| `/inviterewards set <invites> <role>` | ➕ Give a role when someone reaches a number of invites. |
| `/inviterewards remove <invites>` | ➖ Remove a reward. |
| `/inviterewards list` | 📜 Show all invite rewards. |

## /invites

| Command | Description |
| --- | --- |
| `/invites` | 🏆 Show the invite leaderboard of this server. |

## /level

| Command | Description |
| --- | --- |
| `/level rank [user]` | ⭐ Show your level and rank. |
| `/level leaderboard` | 🏆 Top 10 members by XP. |
| `/level reward <level> [role]` | 🎭 Give a role at a level (admins). Leave the role empty to remove. |
| `/level toggle <enabled>` | ⚙️ Turn the level system on or off (admins). |

## /logs

| Command | Description |
| --- | --- |
| `/logs set <channel>` | 📋 Choose the channel where logs are posted. |
| `/logs off` | 🚫 Turn logging off. |

## /ltc

| Command | Description |
| --- | --- |
| `/ltc qr <address> <amount> [currency]` | 🪙 Generate a Litecoin payment QR code. |
| `/ltc price` | 📈 Live Litecoin price. |
| `/ltc check <txid> [address]` | 🔎 Look a Litecoin transaction up. |

## /mod

| Command | Description |
| --- | --- |
| `/mod ban <user> [reason] [delete_days]` | 🔨 Ban a user. |
| `/mod kick <user> [reason]` | 👢 Kick a member. |
| `/mod timeout <user> <duration> [reason]` | 🔇 Timeout (mute) a member. |
| `/mod untimeout <user>` | 🔊 Remove a timeout. |
| `/mod warn <user> <reason>` | ⚠️ Warn a member. |
| `/mod warnings <user>` | 📒 Show the warnings of a member. |
| `/mod clearwarns <user>` | 🧽 Delete all warnings of a member. |
| `/mod lock [reason]` | 🔒 Stop @everyone from sending messages in this channel. |
| `/mod unlock` | 🔓 Unlock this channel again. |
| `/mod slowmode <seconds>` | 🐢 Set the slowmode of this channel. |

## /music

| Command | Description |
| --- | --- |
| `/music play <song>` | ▶️ Play a song (name or link) or add it to the queue. |
| `/music pause` | ⏸️ Pause the music. |
| `/music resume` | ▶️ Resume the music. |
| `/music skip` | ⏭️ Skip the current song. |
| `/music stop` | ⏹️ Stop the music and clear the queue. |
| `/music queue` | 📜 Show the queue. |
| `/music nowplaying` | 🎶 Show the current song. |
| `/music shuffle` | 🔀 Shuffle the queue. |
| `/music loop <mode>` | 🔁 Repeat the current song or the whole queue. |
| `/music volume <percent>` | 🔊 Change the volume (applies from the next song). |

## /poll

| Command | Description |
| --- | --- |
| `/poll <question> <options>` | 📊 Create a button poll. |

## /purge

| Command | Description |
| --- | --- |
| `/purge <amount>` | 🧹 Bulk delete up to 100 messages in this channel. |

## /quickreply

| Command | Description |
| --- | --- |
| `/quickreply set <key> <text>` | Save a ticket reply (Manage Server). |
| `/quickreply remove <key>` | Remove a reply (Manage Server). |
| `/quickreply list` | List reply keys (ticket staff). |
| `/quickreply send <key>` | Send a saved reply in this ticket (ticket staff). |

## /remind

| Command | Description |
| --- | --- |
| `/remind <in> <text>` | ⏰ Set a reminder. |

## /roles

| Command | Description |
| --- | --- |
| `/roles panel <role1> [role2] [role3] [role4] [role5] [title] [description]` | 🎭 Post buttons that let members pick roles. |
| `/roles verify <role> [text]` | ✅ Post a Verify button that gives a role. |

## /server

| Command | Description |
| --- | --- |
| `/server backup` | Privately create a channel backup code. |

## /shop

| Command | Description |
| --- | --- |
| `/shop setup <upi_id> <name>` | ⚙️ Set the UPI details used for orders (admins). |
| `/shop ltc [address]` | 🪙 Accept Litecoin for orders (admins). Leave the address empty to turn it off. |
| `/shop add <name> <price> [stock] [description]` | ➕ Add a product (admins). |
| `/shop remove <product>` | ➖ Remove a product (admins). |
| `/shop stock <product> <amount>` | 📦 Change the stock of a product (admins). |
| `/shop products` | 🛍️ Show all products with price and stock. |
| `/shop product <product>` | Show a product detail card. |
| `/shop style [color] [label] [reset]` | Customize product detail card (Manage Server). |
| `/shop search [number] [customer] [status]` | Privately search tracked orders (staff). |
| `/shop category <product> <name>` | Assign a product category (admin). |
| `/shop dashboard` | Private sales dashboard (admin). |
| `/shop couponstats` | Private coupon statistics (admin). |
| `/shop notes <number>` | View private order notes (staff). |
| `/shop coupon <code> <percent> <days>` | 🎟️ Create or replace a percentage coupon (admins). |
| `/shop uncoupon <code>` | 🎟️ Remove a coupon (admins). |
| `/shop orders` | 🧾 View your recent shop orders privately. |
| `/shop delivered` | 📦 Mark the paid order in this ticket as delivered (staff). |
| `/shop panel [channel] [category]` | 📌 Post the shop with Buy buttons (admins). |

## /staff

| Command | Description |
| --- | --- |
| `/staff status <state>` | Set your availability. |
| `/staff list` | View staff availability privately. |

## /suggest

| Command | Description |
| --- | --- |
| `/suggest setup <channel>` | ⚙️ Choose the suggestions channel (admins). |
| `/suggest idea <text>` | 💡 Suggest something for the server. |

## /ticket

| Command | Description |
| --- | --- |
| `/ticket setup [channel] [category] [support_role] [title] [description] [kind]` | 🎫 Post the ticket panel with the "Create Ticket" button (admins). |
| `/ticket close` | 🔒 Close the ticket you are in. |
| `/ticket summary` | Private summary of this ticket (staff). |
| `/ticket dashboard` | 📊 Ticket claims and feedback (staff). |
| `/ticket priority <level>` | Set ticket priority (staff). |
| `/ticket note <text>` | Add a private staff note to this order. |
| `/ticket inactivity <hours>` | Set inactivity reminders (admin). |
| `/ticket category <kind> [support_role] [category] [question] [reset]` | Configure one panel type (admin). |
| `/ticket add <user>` | ➕ Add a member to this ticket. |
| `/ticket remove <user>` | ➖ Remove a member from this ticket. |

## /upiclear

| Command | Description |
| --- | --- |
| `/upiclear` | Remove your saved UPI ID for this server. |

## /upiqr

| Command | Description |
| --- | --- |
| `/upiqr <amount> [upi_id] [name] [note]` | 💸 Generate a UPI payment QR code. |

## /upiset

| Command | Description |
| --- | --- |
| `/upiset <upi_id> [name]` | Save your UPI ID for payment QR codes in this server. |

## /userinfo

| Command | Description |
| --- | --- |
| `/userinfo [user]` | 🪪 Show information about a member. |

## /vouch

| Command | Description |
| --- | --- |
| `/vouch give <stars> <review>` | ⭐ Leave a review. |
| `/vouch stats` | 📊 Vouch count and average rating. |
| `/vouch channel <channel>` | ⚙️ Choose the vouch channel (admins). |

## /welcome

| Command | Description |
| --- | --- |
| `/welcome set <channel> [message]` | 👋 Welcome new members in a channel. |
| `/welcome goodbye <channel> [message]` | 🚪 Post a message when someone leaves. |
| `/welcome autorole [role]` | 🎭 Give every new member a role (leave empty to turn off). |
| `/welcome off <what>` | 🚫 Turn welcome or goodbye messages off. |
| `/welcome test` | 🧪 Preview the welcome message with yourself. |

