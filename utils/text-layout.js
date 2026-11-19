// Wrap at whitespace where possible, but never discard text or split graphemes.
function wrapPreservingText(value, maxWidth, measure) {
  const text = String(value);
  const graphemes = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment)
    : Array.from(text);
  const lines = []; let current = [];
  for (const char of graphemes) {
    if (current.length && measure(current.join('') + char) > maxWidth) {
      let lastSpace = -1;
      for (let i = current.length - 1; i >= 0; i--) if (/\s/u.test(current[i])) { lastSpace = i; break; }
      if (lastSpace >= 0 && lastSpace < current.length - 1) {
        lines.push(current.slice(0, lastSpace + 1).join(''));
        current = current.slice(lastSpace + 1);
      } else {
        lines.push(current.join('')); current = [];
      }
      // A long token can still overflow after wrapping at the previous space.
      if (current.length && measure(current.join('') + char) > maxWidth) {
        lines.push(current.join('')); current = [];
      }
    }
    current.push(char);
  }
  if (current.length) lines.push(current.join(''));
  return lines;
}
module.exports = { wrapPreservingText };
