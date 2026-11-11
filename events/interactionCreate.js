/**
 * events/interactionCreate.js
 * Routes slash commands to their file in /commands and turns every
 * uncaught error into a red error embed for the user.
 * (Buttons of /help are handled by that command's own collector.)
 */
const { Events, MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');

/** Friendly text for the most common Discord API errors. */
function describe(err) {
  switch (err?.code) {
    case 50013:
      return 'I am missing the permissions needed to do that. Please check my role and channel permissions.';
    case 50001:
      return 'I do not have access to that channel or resource.';
    case 50007:
      return 'I cannot send a DM to that user (their DMs are closed).';
    default:
      return 'Something went wrong while running this command. Please try again in a moment.';
  }
}

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      return interaction
        .reply({
          embeds: [embeds.error(interaction, 'Unknown Command', 'This command no longer exists. Try `/help`.')],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[Command:/${interaction.commandName}]`, err);

      const payload = { embeds: [embeds.error(interaction, 'Command Failed', describe(err))] };
      try {
        if (interaction.deferred || interaction.replied) {
          // Replace the "⌛ loading" embed with the error.
          await interaction.editReply({ ...payload, content: null, components: [], files: [] });
        } else {
          await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
      } catch (replyErr) {
        // Interaction expired or already handled – last attempt, then give up quietly.
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        console.error('[Interaction] Could not send the error embed:', replyErr.message);
      }
    }
  },
};
