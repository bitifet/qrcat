#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import QRCode from 'qrcode';

const RESET = '\x1b[0m';

// Palettes for the two QR "ink" colours: pure black modules on pure white.
// 256-colour indexes 16/231 are fixed black/white in the xterm palette; the
// 16-colour fallback uses the terminal theme's black/white.
const PALETTES = {
  '24bit': {
    fgDark: '\x1b[38;2;0;0;0m', fgLight: '\x1b[38;2;255;255;255m',
    bgDark: '\x1b[48;2;0;0;0m', bgLight: '\x1b[48;2;255;255;255m',
  },
  256: {
    fgDark: '\x1b[38;5;16m', fgLight: '\x1b[38;5;231m',
    bgDark: '\x1b[48;5;16m', bgLight: '\x1b[48;5;231m',
  },
  16: {
    fgDark: '\x1b[30m', fgLight: '\x1b[97m',
    bgDark: '\x1b[40m', bgLight: '\x1b[107m',
  },
};

/** Pick the best colour palette the environment supports. */
export function detectColorLevel(env = process.env) {
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return '24bit';
  if ((env.TERM ?? '').includes('256color')) return '256';
  return '16';
}

// CSI, OSC (BEL or ST terminated), other single-byte escapes, and C1 CSI.
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()#][\x20-\x7e]|[@-_])|\x9b[0-?]*[ -/]*[@-~]/g;
const URL_RE = /https?:\/\/[^\s<>"'`\x1b]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'">]+$/;

const DEFAULT_OPTIONS = { errorCorrectionLevel: 'M', quietZone: 4 };
const IDLE_FLUSH_MS = 100;

// Block Sextants (Unicode 13, U+1FB00..U+1FB3B): one glyph per 2x3 module
// group; filled subcells = dark modules. Subcells are numbered in reading
// order (1 2 / 3 4 / 5 6), so bit (n-1) of the mask = subcell n. The block
// skips masks 21, 42 and 63 (left column, right column, full) because they
// duplicate U+258C, U+2590 and U+2588. Mapping verified against the Unicode
// character names (UCD UnicodeData.txt).
const SEXTANT_BASE = 0x1fb00;
const SEXTANT_SKIPS = [21, 42, 63];
const SEXTANT_EQUIVALENTS = new Map([
  [0, ' '], [21, '▌'], [42, '▐'], [63, '█'],
]);

export function sextantGlyph(mask) {
  if (SEXTANT_EQUIVALENTS.has(mask)) return SEXTANT_EQUIVALENTS.get(mask);
  const skip = SEXTANT_SKIPS.filter((s) => s < mask).length;
  return String.fromCodePoint(SEXTANT_BASE + mask - 1 - skip);
}

// Block Octants (Unicode 16, U+1CD00..U+1CDE5): one glyph per 2x4 module
// group, with filled subcells representing dark modules. Subcells are numbered
// in reading order (1 2 / 3 4 / 5 6 / 7 8), so bit (n - 1) of the mask is
// subcell n. The block skips the 25 combinations that already have equivalent
// single characters elsewhere: the quadrant/half blocks, the quarter bands and
// their halves (the latter encoded as "Block elements" in the Supplement).
// Mapping verified against the Unicode character names (UCD UnicodeData.txt).
const OCTANT_BASE = 0x1cd00;
const OCTANT_SKIPS = [
  1, 2, 3, 5, 10, 15, 20, 40, 63, 64, 80, 85, 90, 95,
  128, 160, 165, 170, 175, 192, 240, 245, 250, 252, 255,
];
const OCTANT_EQUIVALENTS = new Map([
  [0, ' '],
  // Quadrant and half-block combinations (U+2580..U+259F).
  [5, '▘'], [10, '▝'], [15, '▀'], [80, '▖'], [85, '▌'],
  [90, '▞'], [95, '▛'], [160, '▗'], [165, '▚'], [170, '▐'],
  [175, '▜'], [240, '▄'], [245, '▙'], [250, '▟'], [255, '█'],
  // Quarter bands (U+1FB82, U+2582, U+1FB85, U+2586), their middle halves
  // (U+1FBE6, U+1FBE7) and corner halves (U+1CEA8, U+1CEAB, U+1CEA3, U+1CEA0).
  [1, '\u{1CEA8}'], [2, '\u{1CEAB}'], [3, '\u{1FB82}'],
  [20, '\u{1FBE6}'], [40, '\u{1FBE7}'], [63, '\u{1FB85}'],
  [64, '\u{1CEA3}'], [128, '\u{1CEA0}'], [192, '▂'], [252, '▆'],
]);

export function octantGlyph(mask) {
  if (OCTANT_EQUIVALENTS.has(mask)) return OCTANT_EQUIVALENTS.get(mask);
  const skip = OCTANT_SKIPS.filter((s) => s < mask).length;
  return String.fromCodePoint(OCTANT_BASE + mask - 1 - skip);
}

/** Remove terminal escape sequences (colours, OSC 8 links, etc.). */
export function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

function extractUrls(text) {
  const urls = new Set();
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_PUNCT_RE, '');
    if (url) urls.add(url);
  }
  return urls;
}

/**
 * Extract unique http(s) URLs from a line, trimming adjacent punctuation.
 * The stripped copy handles URLs split by colour codes; the raw copy keeps
 * URLs that only exist inside OSC 8 hyperlinks. Raw fragments that are just a
 * prefix of a complete stripped URL are discarded.
 */
export function findUrls(text) {
  const stripped = extractUrls(stripAnsi(text));
  const urls = new Set(stripped);
  for (const url of extractUrls(text)) {
    const isFragment = [...stripped].some((full) => full.length > url.length && full.startsWith(url));
    if (!isFragment) urls.add(url);
  }
  return [...urls];
}

/**
 * Render a URL as a QR over `quietZone`-bordered modules. Packings:
 * - `half` (default): Unicode upper-half blocks; the foreground colour is the
 *   top module, the background one the bottom, so two module rows are packed
 *   into each terminal row and the code stays roughly square.
 * - `sextant`: Unicode Block Sextants (2x3 modules per cell, ~3x smaller
 *   area); filled subcells are the dark modules, so every cell uses the dark
 *   colour as foreground and the light one as background. Needs a terminal
 *   with sextant support; modules end up slightly taller than wide.
 * - `octant`: Unicode Block Octants (2x4 modules per cell, ~4x smaller area);
 *   square modules for the usual 1:2 cell aspect, but needs a terminal with
 *   octant support (newer than sextants).
 */
export function renderQr(url, options = {}) {
  const { errorCorrectionLevel, quietZone } = { ...DEFAULT_OPTIONS, ...options };
  const { packing = 'half', colors = '24bit' } = options;
  const palette = PALETTES[colors];
  const qr = QRCode.create(url, { errorCorrectionLevel });
  const size = qr.modules.size + 2 * quietZone;

  const isDark = (row, col) => {
    const r = row - quietZone;
    const c = col - quietZone;
    if (r < 0 || c < 0 || r >= qr.modules.size || c >= qr.modules.size) return false;
    return qr.modules.get(r, c) === 1;
  };

  if (packing === 'sextant' || packing === 'octant') {
    const rowsPerCell = packing === 'sextant' ? 3 : 4;
    const glyph = packing === 'sextant' ? sextantGlyph : octantGlyph;
    const cols = Math.ceil(size / 2);
    const lines = [];
    for (let row = 0; row < Math.ceil(size / rowsPerCell); row++) {
      let line = '';
      for (let col = 0; col < cols; col++) {
        let mask = 0;
        for (let sub = 0; sub < rowsPerCell * 2; sub++) {
          if (isDark(rowsPerCell * row + Math.floor(sub / 2), 2 * col + (sub % 2))) {
            mask |= 1 << sub;
          }
        }
        line += palette.fgDark + palette.bgLight + glyph(mask);
      }
      lines.push(line + RESET);
    }
    return lines.join('\n');
  }

  const lines = [];
  for (let row = 0; row < size; row += 2) {
    let line = '';
    for (let col = 0; col < size; col++) {
      const top = isDark(row, col);
      const bottom = row + 1 < size ? isDark(row + 1, col) : false;
      line += (top ? palette.fgDark : palette.fgLight) + (bottom ? palette.bgDark : palette.bgLight) + '▀';
    }
    lines.push(line + RESET);
  }
  return lines.join('\n');
}

/** Full output block for one input line: the original line, then a QR per URL. */
export function formatLine(line, options = {}) {
  const urls = findUrls(line);
  if (urls.length === 0) return line;
  const blocks = urls.map((url) => `\n\n${renderQr(url, options)}`);
  return line + blocks.join('') + '\n';
}

/**
 * Process input as it arrives. Complete lines are emitted immediately; an
 * unterminated line is emitted after a short idle period so interactive tools
 * that write a URL without a final newline can still produce a QR promptly.
 */
export function processInput(input, output = process.stdout, idleFlushMs = IDLE_FLUSH_MS, formatOptions = {}) {
  input.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let pending = '';
    let timer;
    let previousWasCR = false;
    let skipNextDelimiter = false;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    const lineEnding = output.isTTY ? '\r\n' : '\n';
    const emitLine = (line) =>
      output.write((formatLine(line, formatOptions) + '\n').replace(/\n/g, lineEnding));

    const onError = (error) => {
      clearTimer();
      reject(error);
    };

    const flushIdle = () => {
      timer = undefined;
      if (!pending) return;
      try {
        emitLine(pending);
        pending = '';
        // The idle flush supplies the line ending; don't emit an extra empty
        // line if the input's actual delimiter arrives later.
        skipNextDelimiter = true;
      } catch (error) {
        onError(error);
      }
    };

    const onData = (chunk) => {
      clearTimer();
      try {
        for (const char of chunk) {
          if (char === '\n' && previousWasCR) {
            previousWasCR = false;
            continue;
          }

          previousWasCR = false;
          if (char === '\n' || char === '\r') {
            if (skipNextDelimiter) {
              skipNextDelimiter = false;
            } else {
              emitLine(pending);
              pending = '';
            }
            previousWasCR = char === '\r';
            continue;
          }

          skipNextDelimiter = false;
          pending += char;
        }

        if (pending) timer = setTimeout(flushIdle, idleFlushMs);
      } catch (error) {
        onError(error);
      }
    };

    const onEnd = () => {
      clearTimer();
      try {
        if (pending) emitLine(pending);
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
  });
}

function printHelp() {
  process.stdout.write(
    'qrcat - add QR codes for URLs in terminal output\n\n' +
      'Usage: command | qrcat\n' +
      '       qrcat -c "command"\n\n' +
      'qrcat reads the output of a command and prints a scannable QR code for\n' +
      'every http(s) URL it finds, so you can open the URL with your phone\n' +
      'instead of copying it by hand:\n\n' +
      '  $ npm login | qrcat\n\n' +
      'Some interactive commands do not work "as is" and need special\n' +
      'redirection or a pseudo-terminal. With -c, qrcat runs the command in a\n' +
      'pseudo-terminal for you and prints its QR codes directly:\n\n' +
      '  $ qrcat -c "npm publish"\n\n' +
      'Check the docs for details:\n\n' +
      '  https://www.npmjs.com/package/qrcat\n\n' +
      'Tip: run `qrcat --help | qrcat` and get a QR code to the docs.\n\n' +
      'Options:\n' +
      '  -c, --command  run the given command in a pseudo-terminal and process\n' +
      '                 its output (requires the `script` utility)\n' +
      '  --small        smaller QRs using Unicode sextant characters (~1/3\n' +
      '                 area; needs a terminal with sextant support)\n' +
      '  --tiny         even smaller QRs using Unicode octant characters\n' +
      '                 (~1/4 area, square; needs octant support)\n' +
      '  --quiet-zone=N quiet zone thickness in modules (0-8, default 4;\n' +
      '                 below 4 is off-spec but scanners cope)\n' +
      '  -h, --help     show this help\n' +
      '  -v, --version  show version\n',
  );
}

/**
 * Run `command` inside a pseudo-terminal (via the `script` utility) so the
 * command keeps its TTY while qrcat processes its combined output, and restore
 * the outer terminal settings on the way out (util-linux `script` can leave
 * them in raw mode when interrupted).
 */
async function runCommand(command, formatOptions) {
  let savedTermios = null;
  if (process.stdin.isTTY) {
    try {
      savedTermios = execFileSync('stty', ['-g'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
    } catch {
      savedTermios = null; // best effort: fall back to `stty sane` below
    }
  }

  const restore = () => {
    if (!process.stdin.isTTY) return;
    try {
      execFileSync('stty', [savedTermios ?? 'sane'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      // Nothing sensible left to try; the outer shell can still `stty sane`.
    }
  };

  const child = spawn('script', ['-qefc', command, '/dev/null'], {
    stdio: ['inherit', 'pipe', 'inherit'],
  });

  let childError = null;
  child.on('error', (error) => {
    childError = error;
  });

  const onSignal = (signal) => {
    child.kill(signal);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    await processInput(child.stdout, process.stdout, IDLE_FLUSH_MS, formatOptions);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    restore();
  }

  const exitCode = await new Promise((resolve) => {
    if (childError) return resolve(null);
    child.on('close', (code) => resolve(code));
  });
  if (childError) throw childError;
  if (exitCode !== 0) process.exitCode = exitCode ?? 1;
}

function parseFormatOptions(args) {
  const options = {
    colors: detectColorLevel(),
    packing: 'half',
    quietZone: DEFAULT_OPTIONS.quietZone,
  };
  for (const arg of args) {
    if (arg === '--small') {
      options.packing = 'sextant';
    } else if (arg === '--tiny') {
      options.packing = 'octant';
    } else if (arg.startsWith('--small=') || arg.startsWith('--tiny=')) {
      process.stderr.write('qrcat: --small and --tiny take no value (they are separate options)\n');
      process.exitCode = 1;
      return null;
    } else if (arg.startsWith('--quiet-zone=')) {
      const value = Number(arg.slice('--quiet-zone='.length));
      if (!Number.isInteger(value) || value < 0 || value > 8) {
        process.stderr.write('qrcat: --quiet-zone expects an integer between 0 and 8\n');
        process.exitCode = 1;
        return null;
      }
      options.quietZone = value;
    }
  }
  return options;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }
  if (args.includes('-v') || args.includes('--version')) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  const commandIndex = args.findIndex((arg) => arg === '-c' || arg === '--command');
  const formatOptions = parseFormatOptions(args);
  if (!formatOptions) return;
  if (commandIndex !== -1) {
    const command = args[commandIndex + 1];
    if (!command || command.startsWith('-')) {
      process.stderr.write('qrcat: -c/--command requires a command string\n');
      process.exitCode = 1;
      return;
    }
    await runCommand(command, formatOptions);
    return;
  }

  await processInput(process.stdin, process.stdout, IDLE_FLUSH_MS, formatOptions);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    process.stderr.write(`qrcat: ${err.message}\n`);
    process.exitCode = 1;
  });
}
