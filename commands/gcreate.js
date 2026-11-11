/**
 * /gcreate <name>
 * Creates a brand-new Discord server owned by the bot and returns
 * an invite link to it.
 *
 * NOTE: Discord only allows this for bots that are in fewer than 10
 * servers, and has been restricting the "create guild" endpoint for
 * apps. If Discord refuses, the user gets a clear red error embed.
 */
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const embeds = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gcreate')
    .setDescription('🏗️ Create a new Discord server owned by the bot.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('name').setDescription('Name of the new server (2-100 characters)').setRequired(true).setMinLength(2).setMaxLength(100),
    ),

  async execute(interaction) {
    const name = interaction.options.getString('name', true).trim();
    await interaction.reply({
      embeds: [embeds.loading(interaction, `Creating server "${name}"...`)],
      flags: MessageFlags.Ephemeral,
    });

    let guild;
    try {
      guild = await interaction.client.guilds.create({
        name,
        channels: [{ name: 'general', type: ChannelType.GuildText }],
      });
    } catch (err) {
      console.error('[/gcreate]', err.code ?? '', err.message);
      let reason = `Discord refused to create the server.\n\`\`\`${String(err.message).slice(0, 300)}\`\`\``;
      if (err.code === 30001) {
        reason = 'Bots can only create servers while they are in **fewer than 10 servers**. This bot is already in too many.';
      } else if (err.status === 403 || err.status === 404 || err.status === 405 || err.code === 20001) {
        reason =
          'Discord no longer allows this bot to create servers (the *Create Guild* endpoint is restricted for apps).\n' +
          'Please create the server manually and invite the bot instead.';
      }
      return interaction.editReply({ embeds: [embeds.error(interaction, 'Server Creation Failed', reason)] });
    }

    // Create a permanent invite so a human can actually join the new server.
    let inviteUrl = null;
    try {
      const channels = await guild.channels.fetch();
      const channel = channels.find((c) => c?.type === ChannelType.GuildText);
      if (channel) inviteUrl = (await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true })).url;
    } catch (err) {
      console.error('[/gcreate] invite failed:', err.message);
    }

    await interaction.editReply({
      embeds: [
        embeds.success(interaction, 'Server Created', `**${guild.name}** is ready and owned by ${interaction.client.user}.`, {
          fields: [
            { name: '🏷️ Name', value: guild.name, inline: true },
            { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
            { name: '🔗 Invite', value: inviteUrl ?? '*Could not create an invite link.*' },
          ],
        }),
      ],
    });
  },
};
