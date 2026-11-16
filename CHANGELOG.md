# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
