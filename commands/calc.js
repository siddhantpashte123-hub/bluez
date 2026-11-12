/**
 * /calc <expression>
 * Calculator. Supports + - * / % ^, brackets, decimals, percentages
 * ("200 + 18%"), k/m/b suffixes ("2.5k") and functions
 * (sqrt, abs, round, floor, ceil, sin, cos, tan, log, ln, min, max, pow).
 *
 * The expression is parsed by a small hand-written parser. `eval` is
 * never used, so nothing a user types can run code.
 */
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const embeds = require('../utils/embeds');

const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTANTS = { pi: Math.PI, e: Math.E };
const SUFFIX = { k: 1e3, m: 1e6, b: 1e9 };

/** Evaluate an expression. Throws an Error with a readable message when it is invalid. */
function evaluate(input) {
  if (/\d\s+\d/.test(String(input))) throw new Error('There is an operator missing between two numbers.');
  const text = String(input)
    .toLowerCase()
    .replace(/[×✕]/g, '*')
    .replace(/(?<=[\d)%]\s*)x(?=\s*[\d(.₹$-])/g, '*') // "499 x 3" (but not the x in "max")
    .replace(/[÷]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/[,₹$\s]/g, (ch) => (ch === ',' ? '\u0001' : '')); // commas: thousands separator or argument separator
  let pos = 0;
  let fnDepth = 0; // inside a function call a comma separates arguments, elsewhere it groups digits (1,00,000)

  const peek = () => text[pos];
  const eat = (ch) => (text[pos] === ch ? (pos++, true) : false);
  const fail = (message) => {
    throw new Error(message);
  };

  function number() {
    const start = pos;
    while (/[0-9]/.test(peek() ?? '') || (peek() === '\u0001' && fnDepth === 0 && pos > start && /[0-9]/.test(text[pos + 1] ?? ''))) pos++;
    if (peek() === '.') {
      pos++;
      while (/[0-9]/.test(peek() ?? '')) pos++;
    }
    const raw = text.slice(start, pos).replace(/\u0001/g, '');
    if (!raw || raw === '.') fail('I expected a number.');
    let value = Number(raw);
    if (SUFFIX[peek()] && !/[a-z]/.test(text[pos + 1] ?? '')) value *= SUFFIX[text[pos++]];
    return value;
  }

  function primary() {
    if (eat('(')) {
      const outer = fnDepth;
      fnDepth = 0; // plain brackets inside a function: commas group digits again
      const value = expression();
      fnDepth = outer;
      if (!eat(')')) fail('A closing bracket `)` is missing.');
      return value;
    }
    if (/[a-z]/.test(peek() ?? '')) {
      const start = pos;
      while (/[a-z0-9]/.test(peek() ?? '')) pos++;
      const name = text.slice(start, pos);
      if (eat('(')) {
        const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : fail(`Unknown function \`${name}\`.`);
        const args = [];
        fnDepth++;
        if (!eat(')')) {
          do args.push(expression());
          while (eat('\u0001'));
          if (!eat(')')) fail('A closing bracket `)` is missing.');
        }
        fnDepth--;
        if (!args.length) fail(`\`${name}()\` needs a value.`);
        return fn(...args);
      }
      if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
      return fail(`I do not understand \`${name}\`.`);
    }
    return number();
  }

  /** value, optionally followed by "%" (-> /100) or "!" is not supported */
  function postfix() {
    const value = primary();
    // "50%" = 0.5, but "10 % 3" is the remainder operator -> only a percentage when no operand follows
    if (peek() === '%' && !/[0-9a-z(.]/.test(text[pos + 1] ?? '')) {
      pos++;
      return { value: value / 100, percent: true };
    }
    return { value, percent: false };
  }

  function power() {
    const base = postfix();
    if (eat('^')) return { value: base.value ** unary().value, percent: false }; // right-associative
    return base;
  }

  function unary() {
    if (eat('-')) return { value: -unary().value, percent: false };
    if (eat('+')) return unary();
    return power();
  }

  function term() {
    let left = unary();
    for (;;) {
      if (eat('*')) left = { value: left.value * unary().value, percent: false };
      else if (eat('/')) {
        const right = unary().value;
        if (right === 0) fail('You cannot divide by zero.');
        left = { value: left.value / right, percent: false };
      } else if (eat('%')) {
        const right = unary().value;
        if (right === 0) fail('You cannot divide by zero.');
        left = { value: left.value % right, percent: false };
      } else if (peek() === '(') left = { value: left.value * primary(), percent: false }; // 2(3+4)
      else return left;
    }
  }

  function expression() {
    let left = term().value;
    for (;;) {
      const sign = eat('+') ? 1 : eat('-') ? -1 : 0;
      if (!sign) return left;
      const right = term();
      // "200 + 18%" means 200 plus 18% of 200, like on a pocket calculator
      left += sign * (right.percent ? left * right.value : right.value);
    }
  }

  if (!text) fail('The expression is empty.');
  const result = expression();
  if (pos < text.length) fail(`I did not expect \`${text[pos] === '\u0001' ? ',' : text[pos]}\` there.`);
  if (!Number.isFinite(result)) fail('The result is not a real number (or it is too large).');
  return result;
}

/** 1234567.5 -> "1,234,567.5" (Indian grouping), tiny/huge numbers in exponent form. */
function format(value) {
  const rounded = Number(value.toPrecision(12)); // hides 0.1 + 0.2 = 0.30000000000000004
  if (rounded !== 0 && (Math.abs(rounded) >= 1e15 || Math.abs(rounded) < 1e-6)) return rounded.toExponential(6).replace(/\.?0+e/, 'e');
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 8 });
}

module.exports = {
  evaluate,
  format,

  data: new SlashCommandBuilder()
    .setName('calc')
    .setDescription('🧮 Calculator.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('expression').setDescription('e.g. 1999 * 3 + 18%   |   (5 + 3) / 2   |   sqrt(144)   |   2.5k * 4').setRequired(true).setMaxLength(200)),

  async execute(interaction) {
    const expression = interaction.options.getString('expression', true).trim();
    let result;
    try {
      result = evaluate(expression);
    } catch (err) {
      return interaction.reply(
        embeds.ephemeral(embeds.error(interaction, 'Invalid Calculation', `${err instanceof RangeError ? 'The expression is too complex.' : err.message}\n\n**Examples:** \`1999 * 3\`, \`500 + 18%\`, \`(5 + 3) / 2\`, \`2^10\`, \`sqrt(144)\`, \`2.5k * 4\``)),
      );
    }
    return interaction.reply({
      embeds: [
        embeds.make(interaction, {
          color: embeds.COLORS.cyan,
          title: '🧮 Calculator',
          fields: [
            { name: '📥 Input', value: `\`\`\`${expression.replace(/`/g, "'")}\`\`\`` },
            { name: '📤 Result', value: `\`\`\`${format(result)}\`\`\`` },
          ],
          thumbnail: false,
        }),
      ],
    });
  },
};
