import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import QRCode from 'qrcode';

import {
  detectColorLevel,
  findUrls,
  formatLine,
  octantGlyph,
  processInput,
  renderQr,
  sextantGlyph,
  stripAnsi,
} from '../bin/qrcat.js';

const BIN = fileURLToPath(new URL('../bin/qrcat.js', import.meta.url));

const COLOR_LEVELS = ['24bit', '256', '16'];

/** Decode an SGR code to its QR role: true = dark ink, false = light paper. */
function decodeColor(code, kind) {
  const dark = {
    fg: ['38;2;0;0;0', '38;5;16', '30'],
    bg: ['48;2;0;0;0', '48;5;16', '40'],
  };
  const light = {
    fg: ['38;2;255;255;255', '38;5;231', '97'],
    bg: ['48;2;255;255;255', '48;5;231', '107'],
  };
  for (const seq of dark[kind]) if (code.includes(seq)) return true;
  for (const seq of light[kind]) if (code.includes(seq)) return false;
  throw new Error(`unrecognized colour code ${JSON.stringify(code)} (${kind})`);
}

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

test('renderQr output round-trips to the source matrix (all palettes)', () => {
  const url = 'https://example.com';
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const quietZone = 4;
  const size = qr.modules.size + 2 * quietZone;
  const expected = (y, x) => {
    const r = y - quietZone;
    const c = x - quietZone;
    return r >= 0 && c >= 0 && r < qr.modules.size && c < qr.modules.size
      ? qr.modules.get(r, c) === 1
      : false;
  };

  for (const colors of COLOR_LEVELS) {
    const lines = renderQr(url, { colors }).split('\n');
    assert.equal(lines.length, Math.ceil(size / 2), `rows for ${colors}`);

    const actual = [];
    lines.forEach((line, rowPair) => {
      line.split('▀').slice(0, -1).forEach((cell, x) => {
        const codes = cell.match(/\x1b\[[0-9;]*m/g);
        actual[2 * rowPair] ??= [];
        actual[2 * rowPair][x] = decodeColor(codes[0], 'fg');
        actual[2 * rowPair + 1] ??= [];
        actual[2 * rowPair + 1][x] = decodeColor(codes[1], 'bg');
      });
    });

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        assert.equal(actual[y][x], expected(y, x), `module at ${y},${x} (${colors})`);
      }
    }
  }
});

function roundTripTest(packing, rowsPerCell) {
  const url = 'https://example.com';
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const quietZone = 4;
  const size = qr.modules.size + 2 * quietZone;
  const expected = (y, x) => {
    const r = y - quietZone;
    const c = x - quietZone;
    return r >= 0 && c >= 0 && r < qr.modules.size && c < qr.modules.size
      ? qr.modules.get(r, c) === 1
      : false;
  };

  for (const colors of COLOR_LEVELS) {
    const lines = renderQr(url, { colors, packing }).split('\n');
    assert.equal(lines.length, Math.ceil(size / rowsPerCell), `rows for ${colors}`);

    const actual = [];
    lines.forEach((line, row) => {
      const cells = [...line.matchAll(/\x1b\[[0-9;]*m\x1b\[[0-9;]*m./gu)].map((m) => m[0]);
      assert.equal(cells.length, Math.ceil(size / 2), `cols for ${colors}`);

      for (let col = 0; col < cells.length; col++) {
        const codes = cells[col].match(/\x1b\[[0-9;]*m/g);
        // Mosaic cells use constant colours: dark ink over light paper.
        assert.equal(decodeColor(codes[0], 'fg'), true, `fg for ${colors}`);
        assert.equal(decodeColor(codes[1], 'bg'), false, `bg for ${colors}`);

        const glyph = cells[col].replace(/\x1b\[[0-9;]*m/g, '');
        const masks = packing === 'sextant' ? 64 : 256;
        const toGlyph = packing === 'sextant' ? sextantGlyph : octantGlyph;
        let mask = 0;
        for (let m = 0; m < masks; m++) if (toGlyph(m) === glyph) mask = m;
        for (let sub = 0; sub < rowsPerCell * 2; sub++) {
          const y = rowsPerCell * row + Math.floor(sub / 2);
          const x = 2 * col + (sub % 2);
          actual[y] ??= [];
          actual[y][x] = Boolean(mask & (1 << sub));
        }
      }
    });

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        assert.equal(actual[y][x], expected(y, x), `module at ${y},${x} (${colors})`);
      }
    }
  }
}

test('sextant packing round-trips to the source matrix and is smaller', () => roundTripTest('sextant', 3));

test('octant packing round-trips to the source matrix and is smaller', () => roundTripTest('octant', 4));

test('detectColorLevel picks the palette from the environment', () => {
  assert.equal(detectColorLevel({ COLORTERM: 'truecolor', TERM: 'xterm-256color' }), '24bit');
  assert.equal(detectColorLevel({ COLORTERM: '24bit' }), '24bit');
  assert.equal(detectColorLevel({ TERM: 'screen-256color' }), '256');
  assert.equal(detectColorLevel({ TERM: 'xterm' }), '16');
  assert.equal(detectColorLevel({}), '16');
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

test('CLI --small renders sextant QR codes', () => {
  const result = spawnSync(process.execPath, [BIN, '--small'], {
    input: 'see https://example.test\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /[\u{1FB00}-\u{1FB3B}]/u);
  assert.doesNotMatch(result.stdout, /[\u{1CD00}-\u{1CDE5}]/u);
});

test('CLI --tiny renders octant QR codes', () => {
  const result = spawnSync(process.execPath, [BIN, '--tiny'], {
    input: 'see https://example.test\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /[\u{1CD00}-\u{1CDE5}]/u);
  assert.doesNotMatch(result.stdout, /[\u{1FB00}-\u{1FB3B}]/u);
});

test('CLI rejects valued --small/--tiny and junk --quiet-zone', () => {
  for (const args of [['--small=sextant'], ['--tiny=octant'], ['--quiet-zone=foo'], ['--quiet-zone=9']]) {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      input: '',
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `args ${JSON.stringify(args)}`);
    assert.match(result.stderr, /qrcat:/, `args ${JSON.stringify(args)}`);
  }
});

test('CLI --quiet-zone shrinks the default QR', () => {
  const qrLines = (flags) => {
    const result = spawnSync(process.execPath, [BIN, ...flags], {
      input: 'https://example.test\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split('\n').filter((line) => line.includes('▀')).length;
  };
  // https://example.test is a version-2 symbol (25 modules): 33 and 29 with
  // the quiet zone, so ceil(size / 2) gives 17 and 15 half-block rows.
  assert.equal(qrLines([]), 17);
  assert.equal(qrLines(['--quiet-zone=2']), 15);
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
