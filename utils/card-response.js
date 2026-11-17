/** Send an optional PNG with a readable embed; retry without files if Discord rejects it. */
const { AttachmentBuilder } = require('discord.js');

async function sendCard(interaction, embed, png, name) {
  const send = (payload) => interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
  if (!png) return send({ embeds: [embed] });
  embed.setImage(`attachment://${name}`);
  try {
    return await send({ embeds: [embed], files: [new AttachmentBuilder(png, { name })] });
  } catch (err) {
    console.warn('[Cards] Could not send attachment, using embed:', err.message);
    embed.setImage(null);
    return send({ embeds: [embed], files: [], attachments: [] });
  }
}
module.exports = { sendCard };
