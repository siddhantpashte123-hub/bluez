/**
 * utils/prefix.js
 * ---------------------------------------------------------------
 * Prefix commands:  !help   !calc 2+2   !mod warn @user spamming
 *
 * Every slash command also works with the prefix. Nothing is written
 * twice: the text is parsed with the slash command's own option list
 * and the command file's execute() runs with a small object that
 * behaves like a slash-command interaction (reply, editReply, options…).
 *
 * Two ways to write options
 *   1. In order      !remind 10m drink water
 *                    !gcreate "Nitro Classic" 1d 2
 *      - words with spaces go in "quotes"
 *      - the last required text option takes everything that is left
 *   2. By name       !embed title:Hello description:Welcome to the server color:#ff0000
 *      (same names as the slash command shows; needed for optional text options)
 *
 * The permission a slash command requires (setDefaultMemberPermissions)
 * is checked here as well, because Discord only enforces it for slash
 * commands.
 * ---------------------------------------------------------------
 */
const { ApplicationCommandOptionType: T, PermissionsBitField } = require('discord.js');
const embeds = require('./embeds');

const PREFIX = '!';
const COOLDOWN_MS = 1500;
const EPHEMERAL = 64;
const lastUse = new Map(); // userId -> timestamp

/** Split text into words; "quoted text" stays together. */
function tokenize(text) {
  const tokens = [];
  const re = /"([^"]*)"|“([^”]*)”|(\S+)/g;
  let m;
  while ((m = re.exec(text))) tokens.push({ text: m[1] ?? m[2] ?? m[3], quoted: m[3] === undefined });
  return tokens;
}

const idOf = (text, pattern) => text.match(pattern)?.[1] ?? (/^\d{16,20}$/.test(text) ? text : null);

/** Turn one piece of text into the value of an option. Returns undefined when it does not fit. */
async function convert(option, text, message) {
  const { guild } = message;
  switch (option.type) {
    case T.String: {
      if (option.choices) {
        const choice = option.choices.find((c) => String(c.value).toLowerCase() === text.toLowerCase() || c.name.toLowerCase() === text.toLowerCase());
        return choice?.value;
      }
      return text;
    }
    case T.Integer:
      return /^[+-]?\d+$/.test(text) ? Number(text) : undefined;
    case T.Number:
      return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : undefined;
    case T.Boolean:
      if (/^(true|yes|on|enable|enabled|1)$/i.test(text)) return true;
      if (/^(false|no|off|disable|disabled|0)$/i.test(text)) return false;
      return undefined;
    case T.User: {
      const id = idOf(text, /^<@!?(\d+)>$/);
      if (!id) return undefined;
      const member = await guild.members.fetch(id).catch(() => null);
      const user = member?.user ?? (await message.client.users.fetch(id).catch(() => null));
      return user ? { user, member } : undefined;
    }
    case T.Role: {
      const id = idOf(text, /^<@&(\d+)>$/);
      const role = id ? guild.roles.cache.get(id) : guild.roles.cache.find((r) => r.name.toLowerCase() === text.replace(/^@/, '').toLowerCase());
      return role ?? undefined;
    }
    case T.Channel: {
      const id = idOf(text, /^<#(\d+)>$/);
      const channel = id ? guild.channels.cache.get(id) : guild.channels.cache.find((c) => c.name.toLowerCase() === text.replace(/^#/, '').toLowerCase());
      if (!channel) return undefined;
      if (option.channel_types && !option.channel_types.includes(channel.type)) return undefined;
      return channel;
    }
    default:
      return undefined;
  }
}

/** Limits of an option (min/max). Returns an error text or null. */
function limitError(option, value) {
  if (typeof value === 'number') {
    if (option.min_value !== undefined && value < option.min_value) return `\`${option.name}\` must be at least **${option.min_value}**.`;
    if (option.max_value !== undefined && value > option.max_value) return `\`${option.name}\` can be at most **${option.max_value}**.`;
  }
  if (typeof value === 'string') {
    if (option.min_length !== undefined && value.length < option.min_length) return `\`${option.name}\` needs at least **${option.min_length}** characters.`;
    if (option.max_length !== undefined && value.length > option.max_length) return `\`${option.name}\` can have at most **${option.max_length}** characters.`;
  }
  return null;
}

const KIND = { [T.String]: 'text', [T.Integer]: 'number', [T.Number]: 'number', [T.Boolean]: 'true/false', [T.User]: '@user', [T.Role]: '@role', [T.Channel]: '#channel' };
const usageOf = (path, options) => `${PREFIX}${path} ${options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ')}`.trim();

class UsageError extends Error {}

/**
 * Fill the options of a command from the words the user typed.
 * @returns {Promise<Map<string, any>>}
 */
async function parseOptions(options, tokens, message, path) {
  const values = new Map();
  const names = new Set(options.map((o) => o.name));
  const set = async (option, text) => {
    const value = await convert(option, text, message);
    if (value === undefined) {
      const choices = option.choices ? ` Choose one of: ${option.choices.map((c) => `\`${c.value}\``).join(', ')}.` : '';
      throw new UsageError(`\`${text.slice(0, 60)}\` is not a valid value for \`${option.name}\` (${KIND[option.type] ?? 'value'}).${choices}`);
    }
    const problem = limitError(option, value);
    if (problem) throw new UsageError(problem);
    values.set(option.name, value);
  };

  const named = tokens.some((t) => !t.quoted && names.has(t.text.slice(0, t.text.indexOf(':')).toLowerCase()) && t.text.includes(':'));

  if (named) {
    // name:value name:several words name:"quoted"
    let current = null;
    const parts = new Map();
    for (const token of tokens) {
      const colon = token.quoted ? -1 : token.text.indexOf(':');
      const key = colon > 0 ? token.text.slice(0, colon).toLowerCase() : null;
      if (key && names.has(key)) {
        current = key;
        parts.set(current, []);
        if (token.text.length > colon + 1) parts.get(current).push(token.text.slice(colon + 1));
      } else if (current) parts.get(current).push(token.text);
      else throw new UsageError(`Start every option with its name, like \`${options[0].name}:value\`.`);
    }
    for (const [key, words] of parts) {
      if (!words.length) throw new UsageError(`\`${key}:\` has no value.`);
      await set(options.find((o) => o.name === key), words.join(' '));
    }
  } else {
    // In order. The last required text option is "greedy" and takes what is left.
    const greedy = options.findLast((o) => o.required && o.type === T.String && !o.choices) ?? null;
    const queue = [...tokens];
    for (let i = 0; i < options.length && queue.length; i++) {
      const option = options[i];
      const later = options.slice(i + 1);

      if (option === greedy || (!greedy && i === options.length - 1 && option.type === T.String && !option.choices)) {
        // Mentions at the very end may belong to optional @user/@role/#channel options that follow.
        const tail = [];
        const wanted = later.filter((o) => [T.User, T.Role, T.Channel].includes(o.type));
        while (wanted.length && queue.length > 1) {
          const lastToken = queue.at(-1);
          const index = wanted.findIndex((o) => ({ [T.User]: /^<@!?\d+>$/, [T.Role]: /^<@&\d+>$/, [T.Channel]: /^<#\d+>$/ })[o.type].test(lastToken.text));
          if (index === -1) break;
          tail.push([wanted.splice(index, 1)[0], queue.pop().text]);
        }
        await set(option, queue.splice(0).map((t) => t.text).join(' '));
        for (const [o, text] of tail) await set(o, text);
        break;
      }

      const text = queue[0].text;
      if (option.required) {
        await set(option, text);
        queue.shift();
      } else if ((await convert(option, text, message)) !== undefined) {
        await set(option, text); // optional options are skipped when the word does not fit them
        queue.shift();
      }
    }
    if (queue.length) throw new UsageError(`I did not understand \`${queue[0].text.slice(0, 60)}\`. Put text with spaces in "quotes" or use \`name:value\`.`);
  }

  const missing = options.filter((o) => o.required && !values.has(o.name));
  if (missing.length) throw new UsageError(`Missing: ${missing.map((o) => `\`${o.name}\` (${o.description})`).join(', ')}`);
  return values;
}

/** Object with the same getters as interaction.options. */
function optionResolver(values, sub, group) {
  const get = (name) => values.get(name) ?? null;
  return {
    getSubcommand: () => sub,
    getSubcommandGroup: () => group,
    getString: get,
    getInteger: get,
    getNumber: get,
    getBoolean: get,
    getRole: get,
    getChannel: get,
    getUser: (name) => get(name)?.user ?? null,
    getMember: (name) => get(name)?.member ?? null,
  };
}

/** Minimal stand-in for a ChatInputCommandInteraction, backed by a normal message. */
function fakeInteraction(message, command, options) {
  let response = null;
  // "Only you can see this" does not exist for normal messages -> sent as a normal reply.
  const clean = (payload) => {
    const out = typeof payload === 'string' ? { content: payload } : { ...payload };
    if (typeof out.flags === 'number') out.flags &= ~EPHEMERAL;
    if (!out.flags) delete out.flags;
    delete out.ephemeral;
    delete out.withResponse;
    delete out.fetchReply;
    return out;
  };
  const interaction = {
    id: message.id,
    client: message.client,
    guild: message.guild,
    guildId: message.guildId,
    channel: message.channel,
    channelId: message.channelId,
    user: message.author,
    member: message.member,
    memberPermissions: message.member?.permissions ?? new PermissionsBitField(),
    appPermissions: message.channel.permissionsFor(message.guild.members.me) ?? new PermissionsBitField(),
    commandName: command.data.name,
    createdTimestamp: message.createdTimestamp,
    options,
    replied: false,
    deferred: false,
    isPrefix: true,
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    inGuild: () => true,
    async reply(payload) {
      interaction.replied = true;
      response = await message.reply(clean(payload)).catch(() => message.channel.send(clean(payload))); // original message deleted
      return response;
    },
    async deferReply() {
      interaction.deferred = true;
      await message.channel.sendTyping?.().catch(() => {});
    },
    async editReply(payload) {
      if (!response) return interaction.reply(payload);
      response = await response.edit(clean(payload));
      return response;
    },
    followUp: (payload) => message.channel.send(clean(payload)),
    fetchReply: async () => response,
    async deleteReply() {
      await response?.delete().catch(() => {});
    },
  };
  return interaction;
}

/**
 * Run a "!command" message. Returns true when the message was a prefix command
 * (even a failed one), false when it should be treated as normal chat.
 */
async function handle(message) {
  if (!message.content?.startsWith(PREFIX) || message.content.length <= PREFIX.length) return false;
  const tokens = tokenize(message.content.slice(PREFIX.length));
  if (!tokens.length || tokens[0].quoted) return false;
  const command = message.client.commands.get(tokens[0].text.toLowerCase());
  if (!command) return false; // "!!!" or "!lol" is just chat

  const me = message.guild.members.me;
  if (!message.channel.permissionsFor(me)?.has(['SendMessages', 'EmbedLinks'])) return true;
  const fail = (title, text) => message.reply({ embeds: [embeds.error(message, title, text)] }).catch(() => {});

  // Tiny cooldown against command spam.
  const now = Date.now();
  if (now - (lastUse.get(message.author.id) ?? 0) < COOLDOWN_MS) return true;
  lastUse.set(message.author.id, now);
  if (lastUse.size > 5000) lastUse.clear();

  // Same permission the slash command requires.
  const data = command.data.toJSON();
  if (data.default_member_permissions != null) {
    const needed = new PermissionsBitField(BigInt(data.default_member_permissions));
    const has = needed.bitfield === 0n ? message.member?.permissions.has('Administrator') : message.member?.permissions.has(needed);
    if (!has) {
      await fail('Missing Permission', `You need **${needed.toArray().join(', ').replace(/([a-z])([A-Z])/g, '$1 $2') || 'Administrator'}** to use \`${PREFIX}${data.name}\`.`);
      return true;
    }
  }

  // Walk down subcommand group / subcommand.
  let options = data.options ?? [];
  let path = data.name;
  let sub = null;
  let group = null;
  let index = 1;
  while (options.some((o) => o.type === T.Subcommand || o.type === T.SubcommandGroup)) {
    const word = tokens[index]?.text.toLowerCase();
    const next = options.find((o) => o.name === word);
    if (!next) {
      await fail(
        word ? 'Unknown Subcommand' : 'Choose a Subcommand',
        `**Options:**\n${options.map((o) => `\`${PREFIX}${path} ${o.name}\` — ${o.description}`).join('\n').slice(0, 3500)}`,
      );
      return true;
    }
    if (next.type === T.SubcommandGroup) group = next.name;
    else sub = next.name;
    path += ` ${next.name}`;
    options = next.options ?? [];
    index++;
  }

  let values;
  try {
    values = await parseOptions(options, tokens.slice(index), message, path);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    const details = options.map((o) => `\`${o.name}\` ${o.required ? '' : '*(optional)* '}— ${o.description}`).join('\n');
    await fail('Wrong Usage', `${err.message}\n\n**Usage:** \`${usageOf(path, options)}\`\n${details}`.slice(0, 3900));
    return true;
  }

  const interaction = fakeInteraction(message, command, optionResolver(values, sub, group));
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Prefix:${PREFIX}${path}]`, err);
    const text = err?.code === 50013 ? 'I am missing the permissions needed to do that. Please check my role and channel permissions.' : 'Something went wrong while running this command. Please try again in a moment.';
    await interaction.editReply({ embeds: [embeds.error(message, 'Something Went Wrong', text)], components: [], files: [], content: null }).catch(() => {});
  }
  return true;
}

module.exports = { PREFIX, handle, tokenize };
