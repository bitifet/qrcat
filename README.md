qrcat - Add QR codes for urls in your terminal output
-----------------------------------------------------


qrcat is a terminal filter that detects URLs in your terminal output and generates additional rows with QR codes for those URLs. This allows you to easily scan the QR codes with your phone or other device to quickly access the URLs.

**Example:**

```bash
$ # Capture a terminal session, including both stdout and stderr
$ (
$   trap 'stty sane' EXIT
$   script -qefc 'npm publish' /dev/null | qrcat
$ )
```

## Install

```bash
npm install -g qrcat
```

Or run from a checkout with `npm install` followed by `node bin/qrcat.js` (or `npm link`).

## Usage

Pipe any command through `qrcat`. Each line is echoed unchanged; after any line
containing an `http(s)` URL, one QR code per URL is printed directly below it.
Multiple URLs on one line each get their own QR code.

```bash
command | qrcat
qrcat --help
qrcat --version
```

### Interactive commands and output streams

qrcat reads **stdin only**. A plain `|` connects stdout, while `2> >(qrcat)` sends
only stderr. Commands may write different URLs to different streams. For
example, `npm publish` writes its initial publishing notice to stderr, but its
web-auth URL to stdout. Thus `npm publish 2> >(qrcat)` can show a QR for the
registry notice but not the auth URL.

Redirecting stdout directly can also change command behavior: npm only runs its
interactive web-auth flow when stdout is a TTY. `npm publish > >(qrcat)` makes
stdout a pipe, and can make npm exit with `EOTP` instead of starting that flow.

On Linux with util-linux `script`, capture both streams through a pseudo-terminal
so the command still sees a TTY while qrcat receives its output:

```bash
(
  trap 'stty sane' EXIT
  script -qefc 'npm publish' /dev/null | qrcat
)
```

This is useful for other interactive commands too. For non-interactive commands,
ordinary pipes or process substitution are simpler; choose the stream(s) that
actually contain the URLs. Process substitution (`> >(qrcat)`) requires bash or
zsh and is not POSIX `sh`.

#### Caveat: restore the terminal after Ctrl+C

On some systems, interrupting `script` with Ctrl+C can leave the outer terminal
in raw mode. You may stop seeing typed input, and Ctrl+C may no longer interrupt
the next command. Recover with:

```bash
stty sane
```

The example above runs `script` in a subshell with an `EXIT` trap to restore
terminal settings automatically, including when interrupted.

qrcat emits newline-terminated lines as soon as they arrive. It also flushes an
unterminated line after 100 ms of input inactivity, which supports interactive
prompts that write partial lines. This idle flush may split a line if a program
pauses for longer than 100 ms while writing it.

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
