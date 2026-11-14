/**
 * Self-roles and verification
 * ---------------------------------------------------------------
 * /roles panel <role1> [role2..role5] [title] [description]
 *        Posts buttons; pressing one gives / removes that role.
 * /roles verify <role> [text]
 *        Posts a "Verify" button that gives the role (never removes it).
 *
 * Button IDs: "roles_t_<roleId>" (toggle) and "roles_v_<roleId>" (verify).
 * They keep working after a restart; nothing has to be stored.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embeds = require('../utils/embeds');

const P = PermissionFlagsBits;
/** Roles with these permissions may never be handed out by a button. */
const DANGEROUS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ModerateMembers, P.ManageMessages, P.MentionEveryone, P.ManageWebhooks];

/** Why this role cannot be used on a button (null = fine). */
function roleProblem(guild, role) {
  if (role.id === guild.id || role.managed) return `${role} cannot be given to members.`;
  if (DANGEROUS.some((perm) => role.permissions.has(perm))) return `${role} has moderation permissions, so it cannot be a self-role.`;
  if (guild.members.me.roles.highest.comparePositionTo(role) <= 0) return `My role must be **above** ${role} in the role list.`;
  return null;
}

/** A member pressed a role button. */
async function handleButton(interaction) {
  const [, mode, roleId] = interaction.customId.split('_');
  const { guild, member } = interaction;
  const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));

  if (!role) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'Role Not Found', 'That role no longer exists. Please tell an admin.')));
  const problem = guild.members.me.permissions.has(P.ManageRoles) ? roleProblem(guild, role) : 'I need the **Manage Roles** permission.';
  if (problem) return interaction.reply(embeds.ephemeral(embeds.error(interaction, 'I Cannot Give That Role', problem)));

  const has = member.roles.cache.has(role.id);
  if (mode === 'v') {
    if (has) return interaction.reply(embeds.ephemeral(embeds.info(interaction, `${embeds.e('tick')} Already Verified`, 'You already have access.', { color: embeds.COLORS.green })));
    await member.roles.add(role, 'Verification button');
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Verified', `Welcome! You now have ${role}. ${embeds.e('bow')}`)));
  }
  if (has) {
    await member.roles.remove(role, 'Self-role button');
    return interaction.reply(embeds.ephemeral(embeds.warn(interaction, 'Role Removed', `You no longer have ${role}.`)));
  }
  await member.roles.add(role, 'Self-role button');
  return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Role Added', `You now have ${role}.`)));
}

const command = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('🎭 Self-role buttons and verification.')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(P.ManageRoles)
  .addSubcommand((s) => {
    s.setName('panel').setDescription('🎭 Post buttons that let members pick roles.');
    for (let i = 1; i <= 5; i++) s.addRoleOption((o) => o.setName(`role${i}`).setDescription(`Role ${i}`).setRequired(i === 1));
    return s
      .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(200))
      .addStringOption((o) => o.setName('description').setDescription('Panel text').setMaxLength(1500));
  })
  .addSubcommand((s) =>
    s.setName('verify').setDescription('✅ Post a Verify button that gives a role.')
      .addRoleOption((o) => o.setName('role').setDescription('Role given after verifying').setRequired(true))
      .addStringOption((o) => o.setName('text').setDescription('Text above the button').setMaxLength(1500)),
  );

module.exports = {
  handleButton,
  data: command,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, channel } = interaction;
    const fail = (title, text) => interaction.reply(embeds.ephemeral(embeds.error(interaction, title, text)));

    if (!guild.members.me.permissions.has(P.ManageRoles)) return fail('I Am Missing Permissions', 'I need the **Manage Roles** permission.');
    if (!channel?.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
      return fail('I Cannot Post Here', 'I need **View Channel**, **Send Messages** and **Embed Links** in this channel.');
    }

    if (sub === 'verify') {
      const role = interaction.options.getRole('role', true);
      const problem = roleProblem(guild, role);
      if (problem) return fail('Invalid Role', problem);
      await channel.send({
        embeds: [
          embeds.make(interaction, {
            color: embeds.COLORS.green,
            title: `${embeds.e('tick')} Verification`,
            description: interaction.options.getString('text') ?? `Press the button below to verify and get access to **${guild.name}**.`,
            thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
          }),
        ],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`roles_v_${role.id}`).setLabel('Verify').setEmoji(embeds.e('tick')).setStyle(ButtonStyle.Success))],
      });
      return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Verification Panel Posted', `Members who press the button get ${role}.`)));
    }

    // panel
    const roles = [];
    for (let i = 1; i <= 5; i++) {
      const role = interaction.options.getRole(`role${i}`);
      if (role && !roles.some((r) => r.id === role.id)) roles.push(role);
    }
    for (const role of roles) {
      const problem = roleProblem(guild, role);
      if (problem) return fail('Invalid Role', problem);
    }
    await channel.send({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.purple,
          title: `${embeds.e('bow')} ${interaction.options.getString('title') ?? 'Pick Your Roles'}`,
          description:
            `${interaction.options.getString('description') ?? 'Press a button to get a role. Press it again to remove it.'}\n\n` +
            roles.map((role) => `🎭 ${role}`).join('\n'),
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          roles.map((role) => new ButtonBuilder().setCustomId(`roles_t_${role.id}`).setLabel(role.name.slice(0, 80)).setStyle(ButtonStyle.Secondary)),
        ),
      ],
    });
    return interaction.reply(embeds.ephemeral(embeds.success(interaction, 'Role Panel Posted', `Members can now pick: ${roles.join(', ')}`)));
  },
};
