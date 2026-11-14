/**
 * utils/transcript.js
 * ---------------------------------------------------------------
 * Builds a self-contained, Discord-styled HTML transcript of a
 * channel (used when a ticket is closed).
 *
 *   const { html, count } = await buildTranscript(channel, { closedBy });
 *
 * Everything written by users is HTML-escaped, so a transcript can
 * never run someone's script when it is opened in a browser.
 * ---------------------------------------------------------------
 */
const MAX_MESSAGES = 2000;

const esc = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Only http(s) links may end up in href/src. */
const safeUrl = (url) => (/^https?:\/\//i.test(String(url ?? '')) ? esc(url) : '');

/** All messages of a channel, oldest first (up to MAX_MESSAGES). */
async function fetchAll(channel) {
  const all = [];
  let before;
  while (all.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/** Discord markdown -> HTML (escaped first; mentions become readable names). */
function markdown(text, guild) {
  if (!text) return '';
  const blocks = [];
  const stash = (html) => `\u0000${blocks.push(html) - 1}\u0000`;

  let out = esc(text);
  out = out.replace(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/gi, (_, code) => stash(`<pre>${code}</pre>`));
  out = out.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${code}</code>`));
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (url) => stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));

  out = out
    .replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
      const member = guild?.members?.cache?.get(id);
      const user = member?.user ?? guild?.client?.users?.cache?.get(id);
      return `<span class="mention">@${esc(member?.displayName ?? user?.username ?? id)}</span>`;
    })
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => `<span class="mention">@${esc(guild?.roles?.cache?.get(id)?.name ?? id)}</span>`)
    .replace(/&lt;#(\d+)&gt;/g, (_, id) => `<span class="mention">#${esc(guild?.channels?.cache?.get(id)?.name ?? id)}</span>`)
    .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, animated, name, id) => `<img class="emoji" alt=":${name}:" title=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=48">`)
    .replace(/&lt;t:(\d+)(?::[a-zA-Z])?&gt;/g, (_, seconds) => `<time class="ts" data-ts="${Number(seconds) * 1000}">${new Date(Number(seconds) * 1000).toUTCString()}</time>`);

  out = out
    .replace(/^### (.+)$/gm, '<strong class="h3">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong class="h2">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong class="h1">$1</strong>')
    .replace(/^&gt; (.+)$/gm, '<span class="quote">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\n/g, '<br>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

function embedHtml(embed, guild) {
  const color = embed.color != null ? `#${embed.color.toString(16).padStart(6, '0')}` : '#4f545c';
  const fields = (embed.fields ?? [])
    .map((f) => `<div class="field${f.inline ? ' inline' : ''}"><div class="field-name">${markdown(f.name, guild)}</div><div>${markdown(f.value, guild)}</div></div>`)
    .join('');
  const thumb = safeUrl(embed.thumbnail?.url);
  const image = safeUrl(embed.image?.url);
  return (
    `<div class="embed" style="border-left-color:${color}">` +
    (thumb ? `<img class="embed-thumb" src="${thumb}" alt="">` : '') +
    (embed.author?.name ? `<div class="embed-author">${esc(embed.author.name)}</div>` : '') +
    (embed.title ? `<div class="embed-title">${markdown(embed.title, guild)}</div>` : '') +
    (embed.description ? `<div class="embed-desc">${markdown(embed.description, guild)}</div>` : '') +
    (fields ? `<div class="fields">${fields}</div>` : '') +
    (image ? `<img class="embed-image" src="${image}" alt="">` : '') +
    (embed.footer?.text ? `<div class="embed-footer">${esc(embed.footer.text)}</div>` : '') +
    '</div>'
  );
}

function attachmentHtml(attachment) {
  const url = safeUrl(attachment.url);
  if (!url) return '';
  const name = esc(attachment.name ?? 'file');
  if ((attachment.contentType ?? '').startsWith('image/')) {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img class="attachment-image" src="${url}" alt="${name}"></a>`;
  }
  return `<a class="attachment" href="${url}" target="_blank" rel="noopener noreferrer">📎 ${name}</a>`;
}

function messageHtml(message, guild) {
  const author = message.author;
  const name = message.member?.displayName ?? author?.globalName ?? author?.username ?? 'Unknown user';
  const avatar = safeUrl(author?.displayAvatarURL?.({ size: 64, extension: 'png' }));
  const buttons = (message.components ?? [])
    .flatMap((row) => row.components ?? [])
    .map((c) => c.label ?? c.data?.label)
    .filter(Boolean)
    .map((label) => `<span class="button">${esc(label)}</span>`)
    .join('');
  return (
    '<div class="message">' +
    (avatar ? `<img class="avatar" src="${avatar}" alt="">` : '<div class="avatar"></div>') +
    '<div class="body">' +
    `<div class="head"><span class="name">${esc(name)}</span>${author?.bot ? '<span class="bot">APP</span>' : ''}` +
    `<time class="ts" data-ts="${message.createdTimestamp}">${new Date(message.createdTimestamp).toUTCString()}</time></div>` +
    (message.content ? `<div class="content">${markdown(message.content, guild)}</div>` : '') +
    (message.embeds ?? []).map((e) => embedHtml(e.data ?? e, guild)).join('') +
    [...(message.attachments?.values?.() ?? [])].map(attachmentHtml).join('') +
    (buttons ? `<div class="buttons">${buttons}</div>` : '') +
    '</div></div>'
  );
}

const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#313338;color:#dbdee1;font-family:"gg sans","Noto Sans",Whitney,"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4}
a{color:#00a8fc;text-decoration:none}a:hover{text-decoration:underline}
header{background:#2b2d31;border-bottom:1px solid #1e1f22;padding:20px 24px;display:flex;gap:16px;align-items:center}
header img{width:64px;height:64px;border-radius:16px}
header h1{margin:0 0 4px;font-size:20px;color:#f2f3f5}
header .meta{color:#b5bac1;font-size:13px}
header .meta b{color:#dbdee1}
main{padding:16px 24px 40px;max-width:1100px}
.message{display:flex;gap:14px;padding:8px 0}
.message:hover{background:#2e3035}
.avatar{width:40px;height:40px;border-radius:50%;flex:none;background:#5865f2}
.body{min-width:0;flex:1}
.name{font-weight:600;color:#f2f3f5}
.bot{background:#5865f2;color:#fff;font-size:10px;font-weight:600;border-radius:3px;padding:1px 5px;margin-left:6px;vertical-align:middle}
.ts{color:#949ba4;font-size:12px;margin-left:8px}
.content .ts,.embed .ts{background:#3f4248;color:#dbdee1;border-radius:3px;padding:0 3px;margin:0;font-size:inherit}
.content{white-space:normal;word-wrap:break-word}
.mention{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:3px;padding:0 3px;font-weight:500}
code{background:#1e1f22;border-radius:4px;padding:1px 5px;font-family:Consolas,"Courier New",monospace;font-size:13px}
pre{background:#1e1f22;border:1px solid #232428;border-radius:4px;padding:10px;font-family:Consolas,"Courier New",monospace;font-size:13px;white-space:pre-wrap;margin:6px 0}
.emoji{width:22px;height:22px;vertical-align:-5px}
.h1{font-size:22px;display:block}.h2{font-size:19px;display:block}.h3{font-size:16px;display:block}
.quote{display:block;border-left:4px solid #4e5058;padding-left:10px}
.embed{position:relative;background:#2b2d31;border-left:4px solid #4f545c;border-radius:4px;padding:10px 14px;margin:6px 0;max-width:560px;overflow:hidden}
.embed-author{font-size:13px;font-weight:600;color:#f2f3f5;margin-bottom:4px}
.embed-title{font-weight:700;color:#f2f3f5;margin-bottom:4px}
.embed-desc{font-size:14px}
.embed-thumb{float:right;width:72px;height:72px;border-radius:4px;margin:0 0 8px 12px;object-fit:cover}
.embed-image{display:block;max-width:100%;border-radius:4px;margin-top:10px}
.embed-footer{clear:both;color:#b5bac1;font-size:12px;margin-top:8px}
.fields{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:8px;font-size:14px}
.field{flex:1 1 100%;min-width:0}.field.inline{flex:1 1 28%}
.field-name{font-weight:700;color:#f2f3f5;margin-bottom:2px}
.attachment-image{display:block;max-width:400px;max-height:300px;border-radius:6px;margin-top:6px}
.attachment{display:inline-block;background:#2b2d31;border:1px solid #232428;border-radius:6px;padding:8px 12px;margin-top:6px}
.buttons{margin-top:6px}.button{display:inline-block;background:#4e5058;color:#fff;border-radius:4px;padding:5px 12px;font-size:13px;margin-right:6px}
footer{color:#949ba4;font-size:12px;text-align:center;padding:16px;border-top:1px solid #1e1f22}
`;

/**
 * @param {import('discord.js').TextChannel} channel
 * @param {{ closedBy?: import('discord.js').User, openedById?: string }} info
 * @returns {Promise<{ html: string, count: number }>}
 */
async function buildTranscript(channel, info = {}) {
  const { guild } = channel;
  const messages = await fetchAll(channel);
  const icon = safeUrl(guild.iconURL?.({ size: 128, extension: 'png' }));
  const opener = info.openedById ? guild.members?.cache?.get(info.openedById) : null;
  const now = Date.now();

  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${esc(channel.name)} — transcript</title><style>${STYLE}</style></head><body>` +
    `<header>${icon ? `<img src="${icon}" alt="">` : ''}<div><h1>#${esc(channel.name)}</h1>` +
    `<div class="meta"><b>${esc(guild.name)}</b> • ${messages.length} message${messages.length === 1 ? '' : 's'}` +
    (info.openedById ? ` • Opened by <b>${esc(opener?.displayName ?? info.openedById)}</b>` : '') +
    (info.closedBy ? ` • Closed by <b>${esc(info.closedBy.username)}</b>` : '') +
    ` • <time class="ts" style="margin:0" data-ts="${now}">${new Date(now).toUTCString()}</time></div></div></header>` +
    `<main>${messages.map((m) => messageHtml(m, guild)).join('\n')}</main>` +
    `<footer>Transcript of #${esc(channel.name)} • ${esc(guild.name)}</footer>` +
    // Show every time in the reader's own time zone.
    '<script>document.querySelectorAll("time[data-ts]").forEach(function(t){t.textContent=new Date(Number(t.dataset.ts)).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})})</script>' +
    '</body></html>';

  return { html, count: messages.length };
}

module.exports = { buildTranscript };
