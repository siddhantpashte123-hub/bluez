/**
 * /help
 * Premium help menu, built as one "Components V2" card:
 *   header with the bot avatar • stats • category list
 *   dropdown to jump to a category
 *   ◀ Back | 🏠 Home | Next ▶ | ✖ Close | Support Server
 * "⌛ Loading..." first, then the menu. The controls are disabled after
 * 60 seconds without a click.
 *
 * If Discord refuses the card for any reason, the classic embed menu
 * (same pages, same buttons) is sent instead.
 */
const {
  SlashCommandBuilder,
  InteractionContextType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
} = require('discord.js');
const embeds = require('../utils/embeds');

const IDLE_MS = 60_000;

/** Support server, shown on the home page and as a button under every page. */
const SUPPORT_URL = 'https://dsc.gg/bluehost';

/** Category pages (page 0 is the generated "Home" page). */
const CATEGORIES = [
  {
    emoji: '🛡️',
    name: 'Moderation',
    color: embeds.COLORS.pink,
    blurb: 'Keep your server clean and organised.',
    commands: [
      ['/purge <amount>', 'Bulk delete up to 100 messages in the current channel.'],
      ['/channel rename <new_name>', 'Rename the current channel.'],
      ['/dm <user> <message>', 'Send a direct message to a member through the bot.'],
      ['/dmall <message>', 'DM an announcement to every member, with live progress.'],
      ['/mod ban | kick | timeout | untimeout <user>', 'Punish or un-mute a member (with reason).'],
      ['/mod warn <user> <reason>', 'Warn a member. See history with `/mod warnings`, reset with `/mod clearwarns`.'],
      ['/mod lock | unlock | slowmode', 'Lock the channel or set a slow mode.'],
      ['/embed <title> <description> [color] [image] [thumbnail] [footer]', 'Send a custom embed.'],
      ['/announce <message> [title] [channel] [ping] [role]', 'Post an announcement, optionally pinging @everyone, @here or a role.'],
    ],
  },
  {
    emoji: '🚨',
    name: 'Protection',
    color: embeds.COLORS.pink,
    blurb: 'Automod, logs and raid protection.',
    commands: [
      ['/automod set <rule> <enabled>', 'Rules: invite links, mass mentions, spam, bad words.'],
      ['/automod word <add | remove> <word>', 'Manage the bad-word list. `/automod status` shows everything.'],
      ['/logs set <channel> | off', 'Log deleted/edited messages, joins, leaves and mod actions.'],
      ['/antiraid set <enabled> [min_account_age_days] [join_limit]', 'Kick brand-new accounts and mass joins.'],
    ],
  },
  {
    emoji: '👋',
    name: 'Welcome & Roles',
    color: embeds.COLORS.green,
    blurb: 'Greet members and hand out roles.',
    commands: [
      ['/welcome set <channel> [message]', 'Welcome embed for new members (shows who invited them).'],
      ['/welcome goodbye | autorole | off | test', 'Goodbye message, automatic role, switch off, preview.'],
      ['/roles panel', 'Post buttons that let members pick their own roles.'],
      ['/roles verify <role>', 'Post a Verify button that gives a role.'],
      ['/inviterewards set <invites> <role>', 'Give a role at N invites. Also `remove` and `list`.'],
    ],
  },
  {
    emoji: '⭐',
    name: 'Levels & Economy',
    color: embeds.COLORS.gold,
    blurb: 'XP for chatting and server coins.',
    commands: [
      ['/level toggle <enabled>', 'Turn the XP system on or off (admins).'],
      ['/level rank [user] | leaderboard', 'Your level card and the top 10.'],
      ['/level reward <level> [role]', 'Give a role at a level (admins).'],
      ['/eco balance | daily | work', 'Check and earn coins.'],
      ['/eco pay <user> <amount> | leaderboard', 'Send coins and see the richest members.'],
    ],
  },
  {
    emoji: '🎲',
    name: 'Community',
    color: embeds.COLORS.purple,
    blurb: 'Polls, suggestions, reminders and fun.',
    commands: [
      ['/poll <question> <options>', 'Button poll with 2-5 options separated by `|`.'],
      ['/suggest setup <channel> | idea <text>', 'Suggestions with 👍 / 👎 votes.'],
      ['/remind <in> <text>', 'Reminder after e.g. `10m`, `2h`, `1d`.'],
      ['/birthday set | remove | list | channel', 'Birthday announcements.'],
      ['/fun 8ball | coinflip | dice | choose', 'Small fun commands.'],
    ],
  },
  {
    emoji: '🛒',
    name: 'Shop',
    color: embeds.COLORS.cyan,
    blurb: 'Sell products with UPI order tickets.',
    commands: [
      ['/shop setup <upi_id> <name>', 'UPI details used for the order QR (admins).'],
      ['/shop ltc [address]', 'Accept Litecoin in order tickets (checked on the blockchain).'],
      ['/shop add | remove | stock', 'Manage products, prices and stock (admins).'],
      ['/shop products', 'Show all products with price and stock.'],
      ['/shop panel [channel]', 'Post the shop with Buy buttons (order ticket + QR, staff marks it paid).'],
      ['/vouch give <stars> <review> | stats | channel', 'Customer reviews with a counter.'],
    ],
  },
  {
    emoji: '🧰',
    name: 'Utility',
    color: embeds.COLORS.cyan,
    blurb: 'Handy everyday tools.',
    commands: [
      ['/upiqr <upi_id> <amount> <name>', 'Generate a UPI payment QR (auto-splits above ₹2,000).'],
      ['/ltc qr <address> <amount> [currency]', 'Litecoin payment QR at the live rate. Also `/ltc price`, `/ltc check <txid>`.'],
      ['/calc <expression>', 'Calculator, e.g. `1999 * 3 + 18%`.'],
      ['/afk <reason>', 'Set your AFK status. I will tell people who ping you.'],
    ],
  },
  {
    emoji: '🔊',
    name: 'Voice',
    color: embeds.COLORS.green,
    blurb: 'Keep a voice channel alive around the clock.',
    commands: [
      ['/247 vc join <voice_channel>', 'Join a voice channel and stay connected 24/7.'],
      ['/247 vc stop', 'Leave the voice channel and turn 24/7 mode off.'],
    ],
  },
  {
    emoji: '🤖',
    name: 'Automation',
    color: embeds.COLORS.purple,
    blurb: 'Let the bot react and reply for you.',
    commands: [
      ['/autoresponder set <trigger> <response>', 'Reply automatically when a message contains the trigger.'],
      ['/autoresponder remove <trigger>', 'Delete an auto-response.'],
      ['/autoresponder list', 'Show all auto-responses of this server.'],
      ['/auto reacter set <trigger> <emoji>', 'React automatically to messages containing the trigger.'],
      ['/auto reacter remove <trigger>', 'Delete an auto-reaction.'],
      ['/auto reacter list', 'Show all auto-reactions of this server.'],
    ],
  },
  {
    emoji: '📊',
    name: 'Info',
    color: embeds.COLORS.gold,
    blurb: 'Stats, leaderboards and this menu.',
    commands: [
      ['/invites', 'Invite leaderboard – top 10 inviters with medals.'],
      ['/invited <user>', "A member's invite count and invite codes."],
      ['/userinfo [user]', "A member's profile: ID, join date, roles and more."],
      ['/info server | avatar | ping | bot', 'Server info, avatars, latency and bot stats.'],
      ['/help', 'Open this help menu.'],
    ],
  },
  {
    emoji: '🎵',
    name: 'Music',
    color: embeds.COLORS.cyan,
    blurb: 'Play songs in your voice channel.',
    commands: [
      ['/music play <song>', 'Play a song by name or link, or add it to the queue.'],
      ['/music pause | resume | skip | stop', 'Control the playback.'],
      ['/music queue | nowplaying | shuffle', 'See and shuffle the queue.'],
      ['/music loop <off | track | queue>', 'Repeat the current song or the whole queue.'],
      ['/music volume <percent>', 'Change the volume (from the next song).'],
    ],
  },
  {
    emoji: '🎁',
    name: 'Giveaways',
    color: embeds.COLORS.green,
    blurb: 'Give prizes away with one button.',
    commands: [
      ['/gcreate <prize> <duration> [winners] [channel]', 'Start a giveaway, e.g. duration `1d12h`.'],
      ['/gcreate … [required_role] [min_invites] [bonus_role]', 'Optional entry requirements and a 2x-chance role.'],
      ['/gend [message_id]', 'End a giveaway now and pick the winner(s).'],
      ['/greroll [message_id] [winners]', 'Pick new winner(s) for an ended giveaway.'],
    ],
  },
  {
    emoji: '🎫',
    name: 'Tickets',
    color: embeds.COLORS.blurple,
    blurb: 'Private support channels at the click of a button.',
    commands: [
      ['/ticket setup [channel] [category] [support_role]', 'Post the ticket panel (Support / Buy / Report buttons).'],
      ['/ticket close', 'Close the ticket you are in.'],
      ['/ticket add <user>', 'Add a member to the current ticket.'],
      ['/ticket remove <user>', 'Remove a member from the current ticket.'],
    ],
  },
];

const TOTAL_PAGES = CATEGORIES.length + 1;
const COMMAND_COUNT = CATEGORIES.reduce((sum, c) => sum + c.commands.length, 0);

/* ------------------------------------------------------------------ */
/*  Premium card (Components V2)                                       */
/* ------------------------------------------------------------------ */

const text = (content) => new TextDisplayBuilder().setContent(content);
const line = (large = false) => new SeparatorBuilder().setDivider(true).setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

/** Dropdown with every category. */
function categoryMenu(page, disabled) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help_select')
      .setPlaceholder(page === 0 ? '✦ Choose a category…' : `${CATEGORIES[page - 1].emoji} ${CATEGORIES[page - 1].name}`)
      .setDisabled(disabled)
      .addOptions(
        { label: 'Home', value: '0', emoji: '🏠', description: 'Overview of everything', default: page === 0 },
        ...CATEGORIES.map((c, i) => ({ label: c.name, value: `${i + 1}`, emoji: c.emoji, description: `${c.commands.length} commands • ${c.blurb}`.slice(0, 100), default: page === i + 1 })),
      ),
  );
}

/** Navigation row. */
function buttons(page, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('help_home').setEmoji('🏠').setStyle(ButtonStyle.Primary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId('help_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('help_close').setEmoji('✖️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    // Link buttons open the URL directly; it stays clickable after the menu times out.
    new ButtonBuilder().setLabel('Support Server').setEmoji('🛟').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
  );
}

/** The whole menu as one card. */
function card(interaction, page, disabled = false) {
  const { client } = interaction;
  const container = new ContainerBuilder();

  if (page === 0) {
    const ping = client.ws?.ping >= 0 ? `${Math.round(client.ws.ping)} ms` : '—';
    container
      .setAccentColor(embeds.COLORS.blurple)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            text(`# ${embeds.e('boostShine')} ${client.user.username}`),
            text(`**Your all-in-one server bot.**\nHey ${interaction.user}! ${embeds.e('bow')} Pick a category from the menu below.`),
          )
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(client.user.displayAvatarURL({ size: 256 }))),
      )
      .addSeparatorComponents(line())
      .addTextDisplayComponents(
        text(
          `${embeds.e('boostGem15')} **Commands** \`${COMMAND_COUNT}\`  •  ${embeds.e('boostGem24')} **Categories** \`${CATEGORIES.length}\`  •  ${embeds.e('nitro')} **Servers** \`${client.guilds.cache.size}\`  •  📶 **Ping** \`${ping}\`\n` +
            '-# Works with slash commands **and** the prefix `!` — for example `/calc` or `!calc 2+2`',
        ),
      )
      .addSeparatorComponents(line())
      .addTextDisplayComponents(text(`### ${embeds.e('gift')} Categories\n${CATEGORIES.map((c) => `${c.emoji} **${c.name}** — ${c.blurb}`).join('\n')}`));
  } else {
    const category = CATEGORIES[page - 1];
    container
      .setAccentColor(category.color)
      .addTextDisplayComponents(text(`## ${category.emoji} ${category.name}\n-# ${category.blurb}`))
      .addSeparatorComponents(line())
      .addTextDisplayComponents(text(category.commands.map(([usage, info]) => `**\`${usage}\`**\n> ${info}`).join('\n')));
  }

  container
    .addSeparatorComponents(line(true))
    .addActionRowComponents(categoryMenu(page, disabled), buttons(page, disabled))
    .addTextDisplayComponents(text(`-# Page ${page + 1}/${TOTAL_PAGES}  •  ${embeds.e('tick')} Support: [dsc.gg/bluehost](${SUPPORT_URL})${disabled ? '  •  Menu expired, run /help again' : ''}`));

  return { components: [container], allowedMentions: { parse: [] } };
}

/** Small card used for "loading" and "closed". */
function notice(content, color) {
  return { components: [new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(text(content))], allowedMentions: { parse: [] } };
}

/* ------------------------------------------------------------------ */
/*  Classic embed menu (fallback)                                      */
/* ------------------------------------------------------------------ */

function pageEmbed(interaction, page) {
  if (page === 0) {
    return embeds.make(interaction, {
      color: embeds.COLORS.blurple,
      title: `${embeds.e('bow')} ${interaction.client.user.username} — Help Menu`,
      description:
        `Hey ${interaction.user}! ${embeds.e('gift')} Welcome to the command centre.\n` +
        'Use the buttons below to browse the categories.\n' +
        'Every command works as a slash command **and** with the prefix `!` — e.g. `/calc` or `!calc 2+2`.\n\u200b',
      fields: [
        ...CATEGORIES.map((c, i) => ({ name: `${c.emoji} ${c.name}`, value: `${c.blurb}\n\`Page ${i + 2}\` • ${c.commands.length} commands`, inline: true })),
        { name: '📈 Stats', value: `**${COMMAND_COUNT}** commands\n**${interaction.client.guilds.cache.size}** servers`, inline: true },
        { name: `${embeds.e('nitro')} Support Server`, value: `Need help or found a bug? Join us: **[dsc.gg/bluehost](${SUPPORT_URL})**` },
      ],
      footer: `Page 1/${TOTAL_PAGES}`,
    });
  }
  const category = CATEGORIES[page - 1];
  return embeds.make(interaction, {
    color: category.color,
    title: `${category.emoji} ${category.name} Commands`,
    description: `*${category.blurb}*\n\n${category.commands.map(([usage, info]) => `${category.emoji} **\`${usage}\`**\n┗ ${info}`).join('\n\n')}`,
    footer: `Page ${page + 1}/${TOTAL_PAGES}`,
  });
}

/* ------------------------------------------------------------------ */
/*  Command                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  card, // exported for tests

  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('✨ Open the interactive help menu.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    let page = 0;
    let premium = true;
    /** Payload of the current page in the active style. */
    const view = (disabled = false) =>
      premium ? card(interaction, page, disabled) : { embeds: [pageEmbed(interaction, page)], components: [buttons(page, disabled)] };

    // "Animation": loading first, then the real menu.
    let message;
    try {
      await interaction.reply({ ...notice('⌛ **Loading help menu...**', embeds.COLORS.cyan), flags: MessageFlags.IsComponentsV2 });
      await embeds.sleep(700);
      message = await interaction.editReply(view());
    } catch (err) {
      // The card was refused -> classic embeds. (A message cannot switch style, so a new one is sent if needed.)
      console.error('[/help] premium card failed, using the classic menu:', err.message);
      premium = false;
      message = interaction.replied ? await interaction.followUp(view()) : await interaction.reply({ ...view(), withResponse: true }).then((r) => r?.resource?.message ?? interaction.fetchReply());
    }
    if (!message?.createMessageComponentCollector) return;

    const collector = message.createMessageComponentCollector({ idle: IDLE_MS });

    collector.on('collect', async (click) => {
      try {
        // Only the person who opened the menu may use it.
        if (click.user.id !== interaction.user.id) {
          return void (await click.reply({
            embeds: [embeds.error(interaction, 'Not Your Menu', 'Run `/help` to open your own help menu.')],
            flags: MessageFlags.Ephemeral,
          }));
        }

        switch (click.customId) {
          case 'help_select':
            page = Math.min(TOTAL_PAGES - 1, Math.max(0, Number(click.values?.[0]) || 0));
            break;
          case 'help_prev':
            page = (page - 1 + TOTAL_PAGES) % TOTAL_PAGES;
            break;
          case 'help_next':
            page = (page + 1) % TOTAL_PAGES;
            break;
          case 'help_home':
            page = 0;
            break;
          case 'help_close': {
            collector.stop('closed');
            const closed = `${embeds.e('bow')} **Help menu closed.** Run \`/help\` whenever you need me again.\n-# Support server: [dsc.gg/bluehost](${SUPPORT_URL})`;
            return void (await click.update(premium ? notice(closed, embeds.COLORS.pink) : { embeds: [embeds.info(interaction, 'Help Menu Closed', closed, { color: embeds.COLORS.pink })], components: [] }));
          }
          default:
            return;
        }

        await click.update(view());
      } catch (err) {
        console.error('[/help] menu error:', err.message);
      }
    });

    // 60s without a click -> grey out the controls.
    collector.on('end', async (_collected, reason) => {
      if (reason === 'closed') return;
      await message.edit(view(true)).catch(() => {});
    });
  },
};
