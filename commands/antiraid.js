/**
 * /antiraid set <enabled> [min_account_age_days] [join_limit]
 * /antiraid status
 *
 * When enabled, new members are kicked if
 *   - their account is younger than `min_account_age_days`, or
 *   - more than `join_limit` members joined within 10 seconds
 *     (raid mode stays active for 2 minutes).
 * `screen(member)` is called from events/guildMemberAdd.js.
 *
 * Storage (data/settings.json): { "<guildId>": { "antiraid": { enabled, minAgeDays, joinLimit } } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

const WINDOW_MS = 10_000;
const RAID_MODE_MS = 2 * 60 * 1000;
/** guildId -> { joins: [timestamps], raidUntil } */
const state = new Map();

/**
 * Check a new member. Returns null when they may stay, otherwise the
 * reason they were kicked.
 */
async function screen(member) {
  const config = db.guild('settings', member.guild.id).antiraid;
  if (!config?.enabled || member.user.bot) return null;

  const now = Date.now();
  const s = state.get(member.guild.id) ?? { joins: [], raidUntil: 0 };
  state.set(member.guild.id, s);
  s.joins = s.joins.filter((t) => now - t < WINDOW_MS);
  s.joins.push(now);
  if (s.joins.length > config.joinLimit) s.raidUntil = now + RAID_MODE_MS;

  let reason = null;
  if (now < s.raidUntil) reason = `Raid protection: more than ${config.joinLimit} joins in ${WINDOW_MS / 1000} seconds`;
  else if (config.minAgeDays > 0 && now - member.user.createdTimestamp < config.minAgeDays * 86_400_000) reason = `Account is younger than ${config.minAgeDays} day(s)`;
  if (!reason || !member.kickable) return null;

  await member
    .send({ embeds: [embeds.warn(member, `Removed from ${member.guild.name}`, `${reason}.\nYou can try to join again later.`)] })
    .catch(() => {});
  try {
    await member.kick(`Anti-raid: ${reason}`);
    return reason;
  } catch (err) {
    console.error('[AntiRaid] kick failed:', err.message);
    return null;
  }
}

module.exports = {
  screen,

  data: new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('🛡️ Raid protection.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('set').setDescription('🛡️ Turn raid protection on or off.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
        .addIntegerOption((o) => o.setName('min_account_age_days').setDescription('Kick accounts younger than this (0 = off, default 0)').setMinValue(0).setMaxValue(365))
        .addIntegerOption((o) => o.setName('join_limit').setDescription('Joins within 10 seconds that count as a raid (default 8)').setMinValue(3).setMaxValue(100)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('📋 Show the raid protection settings.')),

  async execute(interaction) {
    const { guild } = interaction;
    if (interaction.options.getSubcommand() === 'set') {
      const enabled = interaction.options.getBoolean('enabled', true);
      if (enabled && !guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
        return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Am Missing Permissions', 'I need the **Kick Members** permission for raid protection.')));
      }
      const old = db.guild('settings', guild.id).antiraid ?? {};
      db.updateGuild('settings', guild.id, (s) => {
        s.antiraid = {
          enabled,
          minAgeDays: interaction.options.getInteger('min_account_age_days') ?? old.minAgeDays ?? 0,
          joinLimit: interaction.options.getInteger('join_limit') ?? old.joinLimit ?? 8,
        };
      });
    }
    const config = db.guild('settings', guild.id).antiraid ?? { enabled: false, minAgeDays: 0, joinLimit: 8 };
    return interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: config.enabled ? embeds.COLORS.green : embeds.COLORS.pink,
          title: `🛡️ Raid Protection — ${config.enabled ? 'ON' : 'OFF'}`,
          fields: [
            { name: '👶 Minimum account age', value: config.minAgeDays ? `${config.minAgeDays} day(s)` : 'Off', inline: true },
            { name: '🚪 Join limit', value: `${config.joinLimit} joins / 10 s`, inline: true },
            { name: '⚙️ Action', value: 'Kick (they can rejoin later)', inline: true },
          ],
        }),
      ],
    });
  },
};
