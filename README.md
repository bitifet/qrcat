qrcat - Add QR codes for urls in your terminal output
-----------------------------------------------------


qrcat is a terminal filter that detects URLs in your terminal output and generates additional rows with QR codes for those URLs. This allows you to easily scan the QR codes with your phone or other device to quickly access the URLs.

**Example:**

```bash
$ # Login to npm in your computer by scanning a QR code with your phone
$ npm login | qrcat

$ # Or let qrcat run the command in a pseudo-terminal for you
$ qrcat -c "npm publish"
```

> **Note:** some interactive commands do not work with a simple pipe and need
> special redirection or a pseudo-terminal. Use `qrcat -c <command>` for such
> cases instead. See
> [Interactive commands and output streams](#interactive-commands-and-output-streams)
> for more information.

## Install

```bash
npm install -g qrcat
```

## Usage

Pipe any command through `qrcat`. Each line is echoed unchanged; after any line
containing an `http(s)` URL, one QR code per URL is printed directly below it.
Multiple URLs on one line each get their own QR code.

```bash
command | qrcat
qrcat -c "command"
qrcat --help
qrcat --version
```

### Interactive commands and output streams

qrcat reads **stdin only**, and a plain `|` only pipes the command's stdout.
Interactive commands are trickier: they may write URLs to different streams,
and redirecting their output can change how they behave (for example, npm only
runs its interactive web-auth flow when stdout is a TTY).

The recommended way to run them is `-c`, which executes the command inside a
pseudo-terminal and processes its output directly (requires the util-linux
`script` utility, present on most Linux systems):

```bash
qrcat -c "npm publish"
```

qrcat keeps the command's TTY checks intact, prints QR codes for its output as
it arrives, and restores your terminal settings when the command exits or is
interrupted, so Ctrl+C is safe.

For non-interactive commands, ordinary pipes or process substitution are
simpler; choose the stream(s) that actually contain the URLs. If `-c` is not
available or does not fit your case, the
[Appendix](#appendix-manual-workarounds-for-interactive-commands) explains what
`-c` does and provides equivalent manual commands.

### Output handling notes

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
npm link .        # Install locally for testing in your terminal
```

## Appendix: manual workarounds for interactive commands

`qrcat -c "cmd"` is roughly equivalent to wrapping the command with util-linux
`script` and piping it through qrcat:

```bash
(
  trap 'stty sane' EXIT
  script -qefc 'cmd' /dev/null | qrcat
)
```

`script` runs the command inside a pseudo-terminal, so the command keeps its
TTYs while its combined stdout and stderr flow into qrcat.

The `trap` restores the outer terminal settings because interrupting `script`
with Ctrl+C can leave them in raw mode: you may stop seeing typed input, and
Ctrl+C may no longer interrupt the next command. Recover manually with:

```bash
stty sane
```

If you prefer to capture a single stream, process substitution connects it to
qrcat without touching the other one:

```bash
some-command 2> >(qrcat)   # capture stderr only
some-command > >(qrcat)    # capture stdout only
```

Beware that a plain `|` only pipes stdout, and `some-command 2>&1 | qrcat`
merges both streams into a pipe. Interactive commands can behave differently
when their stdout is not a TTY: npm, for instance, exits with `EOTP` instead of
starting its web-auth flow.

Platform notes:

- Process substitution (`> >(qrcat)`) requires bash or zsh; it is not POSIX `sh`.
- The `script -qefc` flags used by `-c` are util-linux's (Linux). BSD/macOS
  `script` uses different flags, so `-c` is currently Linux-oriented.

## License

  [MIT](LICENSE)

## Keywords

filter – cat – url – cli – terminal
