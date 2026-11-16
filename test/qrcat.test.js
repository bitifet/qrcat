import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import QRCode from 'qrcode';

import { findUrls, formatLine, processInput, renderQr, stripAnsi } from '../bin/qrcat.js';

const BIN = fileURLToPath(new URL('../bin/qrcat.js', import.meta.url));

test('findUrls extracts http(s) URLs and trims trailing punctuation', () => {
  assert.deepEqual(findUrls('visit https://example.com/a?b=1.'), ['https://example.com/a?b=1']);
  assert.deepEqual(findUrls('(see http://foo.test/x)'), ['http://foo.test/x']);
});

test('findUrls ignores non-URLs and deduplicates', () => {
  assert.deepEqual(findUrls('ftp://x.test no-url www.example.com'), []);
  assert.deepEqual(findUrls('https://a.test https://a.test https://b.test'), [
    'https://a.test',
    'https://b.test',
  ]);
});

test('stripAnsi removes CSI, OSC 8 links and other escapes', () => {
  const input = '\x1b[36mblue\x1b[39m \x1b]8;;https://a.test\x1b\\link\x1b]8;;\x1b\\ \x1b(Bplain';
  assert.equal(stripAnsi(input), 'blue link plain');
});

test('findUrls handles colour codes around and inside URLs', () => {
  assert.deepEqual(findUrls('\x1b[31mhttps://a.test\x1b[0m.'), ['https://a.test']);
  assert.deepEqual(findUrls('\x1b[36mhttps://\x1b[39m\x1b[4mwww.npmjs.com\x1b[24m/auth.'), [
    'https://www.npmjs.com/auth',
  ]);
  const osc8 = '\x1b]8;;https://a.test/x\x1b\\click here\x1b]8;;\x1b\\';
  assert.deepEqual(findUrls(osc8), ['https://a.test/x']);
});

test('renderQr packs two module rows per terminal row with colour and quiet zone', () => {
  const url = 'https://example.com';
  const size = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules.size + 8;
  const lines = renderQr(url).split('\n');

  assert.equal(lines.length, Math.ceil(size / 2));
  for (const line of lines) {
    assert.equal(line.split('▀').length - 1, size);
    assert.match(line, /\x1b\[38;2;/);
    assert.match(line, /\x1b\[48;2;/);
    assert.ok(line.endsWith('\x1b[0m'));
  }
  // Quiet zone: the first and last module rows must be entirely light.
  assert.ok(lines[0].includes('\x1b[38;2;255;255;255m'));
  assert.ok(!lines[0].includes('\x1b[38;2;0;0;0m'));
});

test('renderQr output round-trips to the source matrix with quiet zone', () => {
  const url = 'https://example.com';
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const quietZone = 4;
  const size = qr.modules.size + 2 * quietZone;
  const rendered = renderQr(url).split('\n');

  const actual = [];
  rendered.forEach((line, rowIndex) => {
    const cells = line.split('▀').slice(0, -1);
    for (let x = 0; x < cells.length; x++) {
      const cell = cells[x];
      const fg = cell.match(/\x1b\[38;2;(\d+);/)[1];
      const bg = cell.match(/\x1b\[48;2;(\d+);/)[1];
      actual[2 * rowIndex] ??= [];
      actual[2 * rowIndex][x] = fg === '0';
      actual[2 * rowIndex + 1] ??= [];
      actual[2 * rowIndex + 1][x] = bg === '0';
    }
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = y - quietZone;
      const c = x - quietZone;
      const expected =
        r >= 0 && c >= 0 && r < qr.modules.size && c < qr.modules.size
          ? qr.modules.get(r, c) === 1
          : false;
      assert.equal(actual[y][x], expected, `module at ${y},${x}`);
    }
  }
});

test('formatLine leaves URL-free lines untouched', () => {
  assert.equal(formatLine('hello world'), 'hello world');
});

test('formatLine emits one QR block per URL', () => {
  const out = formatLine('go https://a.test and https://b.test');
  assert.ok(out.includes(renderQr('https://a.test')));
  assert.ok(out.includes(renderQr('https://b.test')));
  assert.match(out, /^go https:\/\/a\.test and https:\/\/b\.test\n\n/);
});

test('CLI echoes input and appends a QR after a URL line', () => {
  const result = spawnSync(process.execPath, [BIN], {
    input: 'plain line\nsee https://example.com\nlast line\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^plain line\n/);
  assert.match(result.stdout, /see https:\/\/example\.com\n\n/);
  assert.match(result.stdout, /▀/);
  assert.match(result.stdout, /last line\n$/);
});

test('processInput emits unterminated URL lines after a short idle period', async () => {
  const input = new PassThrough();
  const output = [];
  const writeTarget = { write: (chunk) => output.push(chunk) };
  const done = processInput(input, writeTarget, 25);
  const url = 'https://www.npmjs.com/auth/cli/example';

  input.write('Authenticate your account at:\n');
  assert.ok(output.join('').includes('Authenticate your account at:\n'));
  input.write(url.slice(0, 24));
  input.write(url.slice(24)); // chunks need not align with URL boundaries

  await new Promise((resolve) => setTimeout(resolve, 100));
  const whileInputOpen = output.join('');
  assert.ok(whileInputOpen.includes(renderQr(url)));

  // The real delimiter arrives after our idle flush; it must not add a blank
  // line or cause the same URL to be rendered a second time.
  input.write('\nPress ENTER to open in the browser...\n');
  input.end();
  await done;

  const finalOutput = output.join('');
  assert.equal(finalOutput.match(/\x1b\[0m/g).length, renderQr(url).split('\n').length);
  assert.match(finalOutput, /Press ENTER to open in the browser\.\.\.\n$/);
});

test('processInput uses CRLF when writing to a terminal', async () => {
  const input = new PassThrough();
  const output = [];
  const writeTarget = { isTTY: true, write: (chunk) => output.push(chunk) };
  const done = processInput(input, writeTarget, 25);

  input.end('URL https://example.test\n');
  await done;

  const rendered = output.join('');
  assert.ok(rendered.includes('URL https://example.test\r\n\r\n'));
  assert.doesNotMatch(rendered.replace(/\r\n/g, ''), /\n/);
});

test('CLI --version and --help work without reading stdin', () => {
  const version = spawnSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version.stdout.trim(), pkg.version);

  const help = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: command \| qrcat/);
  assert.match(help.stdout, /npmjs\.com\/package\/qrcat/);
});

test('-c runs a command in a PTY and processes its output', () => {
  const result = spawnSync(
    process.execPath,
    [BIN, '-c', 'node -e "console.log(\'hello https://example.test\')"'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hello https:\/\/example\.test/);
  assert.match(result.stdout, /▀/);
});

test('-c without a command argument fails with a clear message', () => {
  const result = spawnSync(process.execPath, [BIN, '-c'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /-c\/--command requires a command string/);
});
