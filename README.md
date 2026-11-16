qcat - Add QR codes for urls in your terminal output
-----------------------------------------------------


qcat is a terminal filter that detects URLs in your terminal output and generates additional rows with QR codes for those URLs. This allows you to easily scan the QR codes with your phone or other device to quickly access the URLs.

**Example:**

```bash
$ # Publish to npm and scan the auth link with your phone
$ npm publish 2> >(qcat)
```

## Install

```bash
npm install -g qcat
```

Or run from a checkout with `npm install` followed by `node bin/qcat.js` (or `npm link`).

## Usage

Pipe any command through `qcat`. Each line is echoed unchanged; after any line
containing an `http(s)` URL, one QR code per URL is printed directly below it.
Multiple URLs on one line each get their own QR code.

```bash
command | qcat
qcat --help
qcat --version
```

### Caveat: which stream carries the URL?

qcat reads **stdin only**, and a plain `|` pipes **stdout only**. Some commands
(notably `npm publish`, whose notices and auth link go to stderr) therefore
produce no QR code, even though pasting the same text into a file and running
`cat file.txt | qcat` works.

**Recommended: process substitution** (bash/zsh). Send the stream that carries
the URL to qcat without turning the command into a pipeline, so its interactive
prompts and terminal behaviour are left alone:

```bash
npm publish 2> >(qcat)   # stderr: notices, auth links, errors
npm login   > >(qcat)   # stdout
```

Use `2> >(qcat)` for commands that write to stderr and `> >(qcat)` for commands
that write to stdout. Prefer one consistent form for both rather than mixing it
with pipes.

`cmd 2>&1 | qcat` also works for simple non-interactive commands, but it merges
**both** streams into the pipe, which can break interactive prompts or change
how the command detects a terminal. If a command stops interacting correctly,
use the process-substitution form instead.

> Process substitution requires bash or zsh; it is not POSIX `sh`.

ANSI colour codes are stripped before URL detection, so coloured output works,
including URLs split by colour sequences and OSC 8 hyperlinks.

QR codes are drawn with Unicode half-block characters and 24-bit ANSI colour, so
they need a terminal with truecolor and `▀` support.

## Development

```bash
npm install
npm test          # node:test suite
```

## License

  [MIT](LICENSE)

## Keywords

filter – cat – url – cli – terminal

