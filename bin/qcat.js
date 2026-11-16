#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import QRCode from 'qrcode';

const RESET = '\x1b[0m';
const FG_DARK = '\x1b[38;2;0;0;0m';
const FG_LIGHT = '\x1b[38;2;255;255;255m';
const BG_DARK = '\x1b[48;2;0;0;0m';
const BG_LIGHT = '\x1b[48;2;255;255;255m';

// CSI, OSC (BEL or ST terminated), other single-byte escapes, and C1 CSI.
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()#][\x20-\x7e]|[@-_])|\x9b[0-?]*[ -/]*[@-~]/g;
const URL_RE = /https?:\/\/[^\s<>"'`\x1b]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'">]+$/;

const DEFAULT_OPTIONS = { errorCorrectionLevel: 'M', quietZone: 4 };

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
 * Render a URL as a QR using Unicode upper-half blocks: the foreground colour
 * is the top module, the background colour the bottom one. Two module rows are
 * packed into each terminal row, which keeps the code roughly square.
 */
export function renderQr(url, options = {}) {
  const { errorCorrectionLevel, quietZone } = { ...DEFAULT_OPTIONS, ...options };
  const qr = QRCode.create(url, { errorCorrectionLevel });
  const size = qr.modules.size + 2 * quietZone;

  const isDark = (row, col) => {
    const r = row - quietZone;
    const c = col - quietZone;
    if (r < 0 || c < 0 || r >= qr.modules.size || c >= qr.modules.size) return false;
    return qr.modules.get(r, c) === 1;
  };

  const lines = [];
  for (let row = 0; row < size; row += 2) {
    let line = '';
    for (let col = 0; col < size; col++) {
      const top = isDark(row, col);
      const bottom = row + 1 < size ? isDark(row + 1, col) : false;
      line += (top ? FG_DARK : FG_LIGHT) + (bottom ? BG_DARK : BG_LIGHT) + '▀';
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

function printHelp() {
  process.stdout.write(
    'qcat - add QR codes for URLs in terminal output\n\n' +
      'Usage: command | qcat\n\n' +
      'Reads stdin line by line, echoes each line unchanged, and prints a QR\n' +
      'code right after any line containing an http(s) URL.\n\n' +
      'Options:\n' +
      '  -h, --help     show this help\n' +
      '  -v, --version  show version\n',
  );
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

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    process.stdout.write(formatLine(line) + '\n');
  }
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
    process.stderr.write(`qcat: ${err.message}\n`);
    process.exitCode = 1;
  });
}
