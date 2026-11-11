/**
 * /dmall <message>
 * DMs every (non-bot) member of the server, one by one, through a
 * rate-limit-safe queue with a live progress embed.
 *
 * ⚠️ Discord treats mass DMs as spam if abused. Only use this for
 *    genuine announcements in servers you manage.
 */
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');

const DELAY_MS = 1500; // pause between two DMs (keeps us far below Discord's limits)
const PROGRESS_EVERY_MS = 4000; // how often the progress embed is edited
const BACKOFF_MS = 30000; // pause when Discord says "you are opening DMs too fast"

/** Guilds that currently have a /dmall running (one job per server). */
const running = new Set();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dmall')
    .setDescription('📢 Send a DM announcement to every member of this server.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('message').setDescription('The announcement to send').setRequired(true).setMaxLength(1800),
    ),

  async execute(interaction) {
    const { guild } = interaction;
    const text = interaction.options.getString('message', true);

    if (running.has(guild.id)) {
      return interaction.reply({
        embeds: [embeds.warn(interaction, 'Already Running', 'A `/dmall` job is already in progress in this server. Please wait for it to finish.')],
      });
    }

    running.add(guild.id);
    try {
      await interaction.reply({ embeds: [embeds.loading(interaction, 'Collecting members...')] });

      // The reply is a normal message, so we can keep editing it with the bot
      // token even after the 15-minute interaction token has expired.
      const progressMessage = await interaction.fetchReply().catch(() => null);
      const edit = async (embed) => {
        try {
          if (progressMessage) await progressMessage.edit({ embeds: [embed] });
          else await interaction.editReply({ embeds: [embed] });
        } catch {
          await interaction.editReply({ embeds: [embed] }).catch(() => {});
        }
      };

      const members = (await guild.members.fetch()).filter((m) => !m.user.bot);
      const queue = [...members.values()];
      const total = queue.length;

      if (!total) {
        return edit(embeds.warn(interaction, 'Nobody to DM', 'This server has no human members to message.'));
      }

      const dmEmbed = embeds.make(interaction, {
        color: embeds.COLORS.blurple,
        title: `📢 Announcement from ${guild.name}`,
        description: text,
        thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
      });

      let sent = 0;
      let failed = 0;
      let lastEdit = 0;

      const progress = () =>
        embeds.make(interaction, {
          color: embeds.COLORS.cyan,
          title: `⌛ Sending... ${sent + failed}/${total}`,
          description: `\`${embeds.bar(sent + failed, total)}\` **${Math.floor(((sent + failed) / total) * 100)}%**`,
          fields: [
            { name: `${embeds.e('tick')} Delivered`, value: `${sent}`, inline: true },
            { name: '🚫 Failed', value: `${failed}`, inline: true },
            { name: '⏱️ Remaining', value: `~${Math.ceil(((total - sent - failed) * DELAY_MS) / 60000)} min`, inline: true },
          ],
        });

      await edit(progress());

      // ---- The queue: strictly one DM at a time, with a delay in between ----
      for (const member of queue) {
        try {
          await member.send({ embeds: [dmEmbed] });
          sent++;
        } catch (err) {
          if (err.code === 40003) {
            // "You are opening direct messages too fast" -> back off, retry once.
            await embeds.sleep(BACKOFF_MS);
            try {
              await member.send({ embeds: [dmEmbed] });
              sent++;
            } catch {
              failed++;
            }
          } else {
            failed++; // 50007 = DMs closed, anything else = skipped
          }
        }

        if (Date.now() - lastEdit > PROGRESS_EVERY_MS) {
          lastEdit = Date.now();
          await edit(progress());
        }
        await embeds.sleep(DELAY_MS);
      }

      await edit(
        embeds.success(interaction, 'Announcement Sent', `Finished messaging the members of **${guild.name}**.`, {
          fields: [
            { name: '👥 Total', value: `${total}`, inline: true },
            { name: `${embeds.e('tick')} Delivered`, value: `${sent}`, inline: true },
            { name: '🚫 Failed (DMs closed)', value: `${failed}`, inline: true },
            { name: '📝 Message', value: text.slice(0, 1024) },
          ],
        }),
      );
    } finally {
      running.delete(guild.id);
    }
  },
};
