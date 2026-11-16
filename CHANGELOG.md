# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Colour auto-detection: truecolor where `COLORTERM` indicates it, otherwise
  the fixed black/white entries of the 256-colour palette, otherwise the
  terminal's 16-colour black/white. QR codes no longer require a truecolor
  terminal.
- `qrcat --small`: render QR codes with Unicode sextant characters (2×3
  modules per cell, roughly a third of the area, slightly stretched). Needs a
  terminal with sextant support (kitty, ghostty, WezTerm, VTE 0.72+).
- `qrcat --tiny`: render QR codes with Unicode octant characters (2×4 modules
  per cell, roughly a quarter of the area, square modules). Needs an
  octant-capable terminal (kitty, ghostty, VTE 0.78+).
- `qrcat --quiet-zone=N`: draw a thinner quiet zone (0–8 modules, default 4)
  to shrink QR codes on any terminal. Below the spec's 4 modules, some
  scanners may struggle.
- `qrcat --help` documents all options.

### Changed

- README: replaced the truecolor requirement with the colour auto-detection
  rules, and added a QR size options comparison table covering the default,
  `--small`, `--tiny` and `--quiet-zone`, with terminal requirements and a
  note that some reader apps (e.g. the stock Xiaomi/MIUI 14 scanner) fail on
  the smaller codes.
- README: new "Real-world use cases" section — npm/Tailscale/GitHub CLI/gcloud/
  Firebase auth flows, the Tailscale SSH authenticate-then-connect trick
  (`qrcat -c 'ssh host true 2>&1' && ssh host`), tunnel and dev-server URLs to
  open on other devices, and tips on aliases and wrapper scripts.

## [0.0.2] - 2026-11-16

### Added

- `qrcat -c "<command>"`: run a command inside a pseudo-terminal (via util-linux
  `script`) and process its combined output, keeping the command's TTY checks
  intact. SIGINT/SIGTERM are forwarded to the command and the outer terminal
  settings are restored on exit or interruption.
- README appendix documenting what `-c` does under the hood, with equivalent
  manual workarounds for interactive commands.

### Changed

- README restructured: `-c` is now the recommended way to run interactive
  commands; stream-routing explanations moved to the appendix.
- Improved `--help` output: use-case oriented description, note on interactive
  command caveats, and a link to the package docs.

## [0.0.1] - 2026-11-16

### Added

- Initial release: `qrcat` terminal filter that detects http(s) URLs in piped
  output and prints a scannable QR code below each one.
- QR rendering with Unicode half-block characters and 24-bit ANSI colour,
  including the required quiet zone (two module rows per terminal row).
- URL detection tolerant to ANSI colour codes and OSC 8 hyperlinks.
- Immediate emission of newline-terminated lines, with an idle flush for
  unterminated lines written by interactive prompts.
- CRLF line endings when writing to a terminal.
