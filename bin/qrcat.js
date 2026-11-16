#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
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
const IDLE_FLUSH_MS = 100;

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

/**
 * Process input as it arrives. Complete lines are emitted immediately; an
 * unterminated line is emitted after a short idle period so interactive tools
 * that write a URL without a final newline can still produce a QR promptly.
 */
export function processInput(input, output = process.stdout, idleFlushMs = IDLE_FLUSH_MS) {
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
      output.write((formatLine(line) + '\n').replace(/\n/g, lineEnding));

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
async function runCommand(command) {
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
    await processInput(child.stdout);
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
  if (commandIndex !== -1) {
    const command = args[commandIndex + 1];
    if (!command || command.startsWith('-')) {
      process.stderr.write('qrcat: -c/--command requires a command string\n');
      process.exitCode = 1;
      return;
    }
    await runCommand(command);
    return;
  }

  await processInput(process.stdin);
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
