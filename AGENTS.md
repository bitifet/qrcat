# AGENTS.md

## What this is
- `qcat` is a stdin/stdout terminal filter: it echoes each input line, then prints a QR code right after any line containing an http(s) URL (`command | qcat`). Usage docs live in `README.md`.

## Layout & commands
- Single implementation file: `bin/qcat.js` (CLI with shebang, exported helpers `findUrls`, `renderQr`, `formatLine`). `test/qcat.test.js` uses `node:test`.
- `npm install` installs the only runtime dep (`qrcode`, pinned). `npm test` runs the suite. There is no build, lint, typecheck, or formatter.
- For a locally linked CLI use `npm link`; `npm pack --dry-run` shows what ships (`files: ["bin"]`).
- The CLI only runs when invoked directly; the main-module check uses `realpathSync` on `process.argv[1]` because npm bin shims are symlinks.

## QR rendering (non-obvious)
- `QRCode.create(url, { errorCorrectionLevel: 'M' })` returns the **raw symbol matrix, with no quiet zone**. `renderQr` adds the required 4-module white border itself (`quietZone` option).
- Each terminal row packs **two** module rows: `▀` uses foreground colour for the top module and background for the bottom (24-bit black/white). `get(row, col) === 1` means dark.
- Symbol sizes are always odd, so the final pair has an extra light half-row; harmless (just a slightly larger bottom quiet zone).
- `test/qcat.test.js` round-trips the ANSI output back into a matrix to verify this packing — keep that test in sync if rendering changes.

## Conventions
- ESM only (`"type": "module"`); Node >= 18. The original `"type": "esm"` was invalid and emitted `MODULE_TYPELESS_PACKAGE_JSON`.
- URL matching is intentionally heuristic (`http(s)://...`, trailing punctuation trimmed) — don't assume full URL-spec parsing. `findUrls` strips ANSI (CSI/OSC 8/charset escapes) before matching, then also checks the raw line for URLs that exist only inside OSC 8 links; raw fragments that prefix a complete stripped URL are discarded.
- **qcat only reads stdin.** A plain `|` pipes stdout only, and npm writes `publish` notices/auth links to stderr. Recommended form is process substitution: `npm publish 2> >(qcat)` (stderr) or `npm login > >(qcat)` (stdout). `2>&1 | qcat` also works but merges both streams into a pipe and can break interactive commands. Verified empirically; don't re-blame ANSI for this symptom.
- `EPIPE` is swallowed so `qcat | head` exits quietly.
- `.ocmux.json` is OpenCode/tmux harness state, not project source.
