qrcat - Add QR codes for urls in your terminal output
-----------------------------------------------------

[![npm version](https://img.shields.io/npm/v/qrcat)](https://www.npmjs.com/package/qrcat)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Dependencies: 1](https://img.shields.io/badge/dependencies-1-green)](https://www.npmjs.com/package/qrcat?activeTab=dependencies)

qrcat is a terminal filter that detects URLs in your terminal output and generates additional rows with QR codes for those URLs. This allows you to easily scan the QR codes with your phone or other device to quickly access the URLs.

![`qrcat --help | qrcat --tiny` in the kitty terminal: a QR code pointing to https://www.npmjs.com/package/qrcat — yes, the QR code in this screenshot scans.](assets/qrcat-tiny-kitty.png)

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

Pipe any command through `qrcat` or use `qrcat -c` for interactive commands.
Each line is echoed unchanged; after any line containing an `http(s)` URL, one
QR code per URL is printed directly below it. Multiple URLs on one line each
get their own QR code.

```bash
command | qrcat
qrcat -c "command"
command | qrcat --small          # ~1/3 area, needs sextant support
command | qrcat --tiny           # ~1/4 area, needs octant support
command | qrcat --quiet-zone=2   # thinner border, works everywhere
qrcat --help
qrcat --version
```

### How is this different from `qrencode` or `qr`?

`qrencode` (and Python's `qr`) are one-shot encoders: you hand them the exact
text to encode. qrcat is a **filter**: pipe any command's output through it and
every `http(s)` URL that goes by gets a QR code printed right below its line,
with the output itself left untouched.

- URL detection survives ANSI colours and OSC 8 hyperlinks and tolerates
  trailing punctuation, so real-world tool output just works.
- `qrcat -c` runs interactive commands (npm login, tailscale ssh, ...) inside a
  pseudo-terminal, so their web-auth URLs reach qrcat without breaking the
  command's TTY checks.
- `--small`, `--tiny` and `--quiet-zone` trade size for terminal support in a
  documented compatibility ladder; colours are auto-detected for any terminal.

### Interactive commands and output streams

qrcat reads **stdin only**, and a plain `|` only pipes the command's stdout.
Interactive commands are trickier: they may write URLs to different streams,
and redirecting their output can change how they behave (for example, npm only
runs its interactive web-auth flow when stdout is a TTY).

The recommended way to run them is `-c`, which executes the command inside a
pseudo-terminal and processes its output directly (requires the util-linux
`script` utility, present on most GNU/Linux systems):

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

QR codes are drawn with Unicode half-block characters (`▀`), using pure black
modules on a pure white background. Colours are auto-detected: truecolor where
available, otherwise the fixed black/white entries of the 256-colour palette
(indexes 16 and 231), otherwise the terminal's 16-colour black/white. The only
hard requirement is a terminal that renders `▀` correctly.

### QR size options

By default the QR is drawn with Unicode half-block characters, which keeps the
modules square and works on any terminal with `▀` support. `--small` and
`--tiny` shrink it further, and `--quiet-zone` thins the border on any
terminal:

| Option | Characters | Area | Form factor | Terminal support |
| ------ | ---------- | ---- | ----------- | ---------------- |
| (default) | half blocks, 1×2 modules per cell | — | square | any terminal with `▀` |
| `--small` | sextants, 2×3 modules per cell | ~⅓ | slightly tall | kitty, ghostty, WezTerm, VTE 0.72+ |
| `--tiny` | octants, 2×4 modules per cell | ~¼ | square | kitty, ghostty, VTE 0.78+ |
| `--quiet-zone=N` | thinner border | ~⅘ at N=2 | square | any terminal |

Notes:

- On a terminal without the required glyphs, `--small` or `--tiny` render as
  garbage; just drop the flag. (For reference, Ubuntu 24.04 ships VTE 0.76,
  which draws sextants but not octants.)
- Some QR reader apps fail on the smaller codes: for example, the stock
  scanner on Xiaomi (MIUI 14) rejects the slightly stretched `--small` codes,
  while a dedicated scanner app reads them without trouble. If a code does not
  scan, try another reader app before blaming the terminal.
- `--quiet-zone` below the spec's 4 modules is off-spec, but phone scanners
  still cope with 2.

## Real-world use cases

Any command that prints an `http(s)` URL can hand it to your phone as a QR
code. (`qrcat --help | qrcat` is a quick way to try it on qrcat itself.)

### Authentication flows

- **npm** — sign in by scanning the web-auth URL (also works mid-`publish`):
  `qrcat -c "npm login"`
- **Tailscale** — register a node by scanning the auth URL:
  `qrcat -c "sudo tailscale up"`
- **GitHub CLI** — device flow: `qrcat -c "gh auth login"`
- **Google Cloud** — `qrcat -c "gcloud auth login --no-launch-browser"`
- **Firebase** — `qrcat -c "firebase login"`

Device-code flows also exchange a one-time code that a QR cannot carry — scan
the URL, then complete the flow by typing the code in whichever direction the
tool asks: usually from the terminal into your phone (GitHub CLI, AWS SSO),
but with gcloud the code appears on the phone and goes back into the terminal.

### Tailscale SSH with QR authentication

Tailscale SSH asks for a single-use auth URL on the first connection. Don't
run the whole interactive session inside `qrcat -c` — its pseudo-terminal is
set up for capturing command output, not for hosting sessions (window resizes,
full-screen apps and typing latency all suffer). Instead, authenticate in a
throwaway session and connect for real afterwards:

```bash
qrcat -c 'ssh remote_host true 2>&1' && ssh remote_host
```

The first `ssh` runs `true` on the remote host: it triggers the auth URL
(→ QR), waits until you scan and approve it, and exits. Only then does `&&`
start your normal, fully interactive `ssh` session, untouched by qrcat.

### URLs to open on your phone

A second very common pattern: commands that print a URL you want to open on
another device. Several of these log to stderr, hence the `2>&1`:

- **Cloudflare quick tunnel** — open your local server from your phone:
  `cloudflared tunnel --url http://localhost:3000 2>&1 | qrcat`
- **ngrok** — same idea: `ngrok http 3000 2>&1 | qrcat`
- **Dev server on your phone** — Vite and other dev servers print their LAN
  URL with `--host`: `vite --host | qrcat`
- **Jupyter notebook on phone/tablet**:
  `jupyter notebook --ip=0.0.0.0 2>&1 | qrcat`
- **VS Code remote tunnel** — open the same project at `vscode.dev` from any
  device: `qrcat -c "code tunnel"`

For long-running commands like these, Ctrl+C ends the pipeline when you are
done.

### Aliases and scripts

Once one of these earns a place in your workflow, alias it; for commands that
take arguments, a three-line script beats any alias:

```bash
alias npmlogin='qrcat -c "npm login"'
alias npmpublish='qrcat -c "npm login && npm publish"'
```

```sh
#!/bin/sh
# ~/bin/tssh — Tailscale SSH authentication via QR code, then connect
qrcat -c "ssh \"$1\" true 2>&1" && ssh "$1"
```

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
- The `script -qefc` flags used by `-c` are util-linux's (GNU/Linux). BSD/macOS
  `script` uses different flags, so `-c` is currently GNU/Linux-oriented.

## License

  [MIT](LICENSE)

## Keywords

filter – cat – url – cli – terminal
