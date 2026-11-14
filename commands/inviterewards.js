/**
 * /inviterewards set <invites> <role>   give a role at N invites
 * /inviterewards remove <invites>
 * /inviterewards list
 *
 * Roles are given automatically when an invited member joins
 * (events/guildMemberAdd.js -> grant()).
 * Storage (data/settings.json): { "<guildId>": { "inviteRewards": { "<invites>": "<roleId>" } } }
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');
const db = require('../utils/db');

/** Give `inviterId` every reward role they have reached. Returns the roles that were added. */
async function grant(guild, inviterId, totalInvites) {
  const rewards = db.guild('settings', guild.id).inviteRewards ?? {};
  const due = Object.entries(rewards).filter(([count]) => totalInvites >= Number(count));
  if (!due.length) return [];
  const member = await guild.members.fetch(inviterId).catch(() => null);
  if (!member) return [];
  const added = [];
  for (const [, roleId] of due) {
    if (member.roles.cache.has(roleId)) continue;
    try {
      await member.roles.add(roleId, 'Invite reward');
      added.push(roleId);
    } catch (err) {
      console.error('[InviteRewards] Could not add role:', err.message);
    }
  }
  return added;
}

module.exports = {
  grant,

  data: new SlashCommandBuilder()
    .setName('inviterewards')
    .setDescription('📨 Roles for inviting members.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('set').setDescription('➕ Give a role when someone reaches a number of invites.')
        .addIntegerOption((o) => o.setName('invites').setDescription('Invites needed').setRequired(true).setMinValue(1).setMaxValue(100000))
        .addRoleOption((o) => o.setName('role').setDescription('Reward role').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('➖ Remove a reward.').addIntegerOption((o) => o.setName('invites').setDescription('Invite count of the reward').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('list').setDescription('📜 Show all invite rewards.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    const rewards = db.guild('settings', guild.id).inviteRewards ?? {};

    if (sub === 'list') {
      const lines = Object.entries(rewards).sort((a, b) => a[0] - b[0]).map(([count, roleId]) => `**${count}** invites → <@&${roleId}>`);
      return interaction.reply({ embeds: [embeds.info(interaction, '📨 Invite Rewards', lines.join('\n') || '*No rewards yet. Add one with `/inviterewards set`.*')] });
    }

    const count = interaction.options.getInteger('invites', true);
    if (sub === 'remove') {
      if (!rewards[count]) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Not Found', `There is no reward at **${count}** invites.`)));
      db.updateGuild('settings', guild.id, (s) => {
        delete s.inviteRewards[count];
      });
      return interaction.reply({ embeds: [embeds.success(interaction, 'Reward Removed', `The reward at **${count}** invites was removed.`)] });
    }

    const role = interaction.options.getRole('role', true);
    const me = guild.members.me;
    if (role.managed || role.id === guild.id || role.position >= me.roles.highest.position || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Give That Role', 'I need **Manage Roles**, and the role must be **below my highest role** (and not a bot/@everyone role).')));
    }
    if (Object.keys(rewards).length >= 15 && !rewards[count]) {
      return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Too Many Rewards', 'You can have up to 15 invite rewards.')));
    }
    db.updateGuild('settings', guild.id, (s) => {
      (s.inviteRewards ??= {})[count] = role.id;
    });
    return interaction.reply({ embeds: [embeds.success(interaction, 'Reward Saved', `Members get ${role} at **${count}** invites.\nI need **Manage Server** to track invites.`)], allowedMentions: { parse: [] } });
  },
};
