# AGENTS.md

## What this is
- `qrcat` is a stdin/stdout terminal filter: it echoes each input line, then prints a QR code right after any line containing an http(s) URL (`command | qrcat`). Usage docs live in `README.md`.

## Layout & commands
- Single implementation file: `bin/qrcat.js` (CLI with shebang, exported helpers `findUrls`, `renderQr`, `formatLine`). `test/qrcat.test.js` uses `node:test`.
- `npm install` installs the only runtime dep (`qrcode`, pinned). `npm test` runs the suite. There is no build, lint, typecheck, or formatter.
- For a locally linked CLI use `npm link`; `npm pack --dry-run` shows what ships (`files: ["bin"]`).
- The CLI only runs when invoked directly; the main-module check uses `realpathSync` on `process.argv[1]` because npm bin shims are symlinks.

## QR rendering (non-obvious)
- `QRCode.create(url, { errorCorrectionLevel: 'M' })` returns the **raw symbol matrix, with no quiet zone**. `renderQr` adds the required 4-module white border itself (`quietZone` option).
- Each terminal row packs **two** module rows: `▀` uses foreground colour for the top module and background for the bottom (24-bit black/white). `get(row, col) === 1` means dark.
- Symbol sizes are always odd, so the final pair has an extra light half-row; harmless (just a slightly larger bottom quiet zone).
- `test/qrcat.test.js` round-trips the ANSI output back into a matrix to verify this packing — keep that test in sync if rendering changes.

## Conventions
- ESM only (`"type": "module"`); Node >= 18. The original `"type": "esm"` was invalid and emitted `MODULE_TYPELESS_PACKAGE_JSON`.
- URL matching is intentionally heuristic (`http(s)://...`, trailing punctuation trimmed) — don't assume full URL-spec parsing. `findUrls` strips ANSI (CSI/OSC 8/charset escapes) before matching, then also checks the raw line for URLs that exist only inside OSC 8 links; raw fragments that prefix a complete stripped URL are discarded.
- **qrcat only reads stdin.** A plain `|` pipes stdout only. In npm 11.20, publish notices go to stderr but its interactive auth URL goes to stdout; `2> >(qrcat)` misses that URL. Redirecting stdout directly makes npm see `stdout.isTTY === false`, disabling the OTP handler and causing `EOTP`. On Linux, `script -qefc 'npm publish' /dev/null | qrcat` captures both streams via a PTY while keeping npm's TTY checks true. Ctrl+C can leave the outer terminal raw; wrap `script` in a subshell with `trap 'stty sane' EXIT` (README example), or recover manually with `stty sane`.
- Input is parsed as chunks; newline-terminated lines emit immediately and unterminated input flushes after 100 ms idle (may split a line if a producer pauses). TTY output explicitly uses CRLF so each QR row returns to column 0 even when the terminal doesn't map LF to CRLF. Test via `processInput` with `PassThrough`.
- `EPIPE` is swallowed so `qrcat | head` exits quietly.
- `.ocmux.json` is OpenCode/tmux harness state, not project source.
