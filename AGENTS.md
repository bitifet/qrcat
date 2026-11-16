# AGENTS.md

## What this is
- `qrcat` is a stdin/stdout terminal filter: it echoes each input line, then prints a QR code right after any line containing an http(s) URL (`command | qrcat`). Usage docs live in `README.md`.

## Layout & commands
- Single implementation file: `bin/qrcat.js` (CLI with shebang, exported helpers `findUrls`, `renderQr`, `formatLine`, `detectColorLevel`, `sextantGlyph`, `octantGlyph`). `test/qrcat.test.js` uses `node:test`.
- `npm install` installs the only runtime dep (`qrcode`, pinned). `npm test` runs the suite. There is no build, lint, typecheck, or formatter.
- For a locally linked CLI use `npm link`; `npm pack --dry-run` shows what ships (`files: ["bin"]`).
- The CLI only runs when invoked directly; the main-module check uses `realpathSync` on `process.argv[1]` because npm bin shims are symlinks.
- `qrcat -c "cmd"` spawns `script -qefc <cmd> /dev/null` (util-linux; BSD/macOS `script` flags differ), processes the PTY's merged output, forwards SIGINT/SIGTERM to the child, and restores the outer terminal with saved `stty -g` (fallback `stty sane`) in a `finally` block. POSIX only; errors clearly if `script` is missing.

## QR rendering (non-obvious)
- `QRCode.create(url, { errorCorrectionLevel: 'M' })` returns the **raw symbol matrix, with no quiet zone**. `renderQr` adds the required 4-module white border itself (`quietZone` option).
- Three packings (`packing` option): `half` (default), `sextant` (`--small`) and `octant` (`--tiny`).
- `half`: each terminal row packs **two** module rows: `▀` uses foreground colour for the top module and background for the bottom. `get(row, col) === 1` means dark.
- `sextant`: Unicode Block Sextants pack **2×3 modules per cell** (~3× smaller area). The glyph itself encodes the dark modules, so every cell uses constant fg=dark / bg=light. Mask bit (n−1) = subcell n in reading order (1 2 / 3 4 / 5 6); the block skips masks 21/42/63 because they duplicate `▌`/`▐`/`█`. Mapping verified against UCD character names; VTE ≥ 0.72 custom-draws them seamlessly (`unistr_is_local_graphic` covers 0x1fb00–0x1fbaf in VTE 0.76 source). Modules render ~4:3 tall at 1:2 cells.
- `octant`: Unicode Block Octants pack **2×4 modules per cell** (~4× smaller area, square modules at the usual 1:2 cell aspect). The block (U+1CD00..U+1CDE5) skips the 25 masks that have equivalent single characters: quadrant/half blocks, quarter bands (U+1FB82/U+2582/U+1FB85/U+2586), their middle halves (U+1FBE6/U+1FBE7) and corner halves (U+1CEA8/U+1CEAB/U+1CEA3/U+1CEA0) — see `OCTANT_EQUIVALENTS`. Mapping verified against UCD character names; kitty rendered the corner singles misaligned until 2026-04 (kitty PR #9850). Needs VTE ≥ 0.78 (0.76 shows tofu), kitty, or ghostty.
- Rejected experiment: **braille** (U+2800, also 2×4) — the round font dots make dotted modules that ZXing and jsQR both fail to decode even at 0.9 dot diameter; don't revisit.
- Reader tolerance varies: the stock Xiaomi/MIUI 14 scanner rejects sextant-stretched QRs (user-verified twice) but reads octant ones; ZXing and jsQR decode every solid packing up to 1.6× stretch (simulated). Don't treat one scanner app's failure as a geometry bug — ask which app was used.
- `--quiet-zone=N` (0–8, default 4): renders with a thinner border; sim-verified scannable at 0–4 with ZXing/jsQR. Off-spec below 4, keep default unless asked.
- Colours: `PALETTES` has `24bit` / `256` / `16` variants of pure black-on-white. Library default is `24bit` (deterministic for tests); the CLI passes `detectColorLevel()` (COLORTERM=truecolor|24bit → 24bit, TERM contains `256color` → 256, else 16). 256-indexes 16/231 are fixed black/white, so most non-truecolor terminals still get exact colours.
- Symbol sizes are always odd, so the final half-block pair has an extra light half-row; harmless (just a slightly larger bottom quiet zone). Octant rows pad the matrix edges with light modules the same way.
- `test/qrcat.test.js` round-trips the ANSI output back into a matrix for both packings and all three palettes — keep those tests in sync if rendering changes.

## Conventions
- ESM only (`"type": "module"`); Node >= 18. The original `"type": "esm"` was invalid and emitted `MODULE_TYPELESS_PACKAGE_JSON`.
- URL matching is intentionally heuristic (`http(s)://...`, trailing punctuation trimmed) — don't assume full URL-spec parsing. `findUrls` strips ANSI (CSI/OSC 8/charset escapes) before matching, then also checks the raw line for URLs that exist only inside OSC 8 links; raw fragments that prefix a complete stripped URL are discarded.
- **qrcat only reads stdin.** A plain `|` pipes stdout only. In npm 11.20, publish notices go to stderr but its interactive auth URL goes to stdout; `2> >(qrcat)` misses that URL. Redirecting stdout directly makes npm see `stdout.isTTY === false`, disabling the OTP handler and causing `EOTP`. On Linux, `script -qefc 'npm publish' /dev/null | qrcat` captures both streams via a PTY while keeping npm's TTY checks true. Ctrl+C can leave the outer terminal raw; wrap `script` in a subshell with `trap 'stty sane' EXIT` (README example), or recover manually with `stty sane`.
- README has a "Real-world use cases" section (auth flows, the Tailscale SSH authenticate-then-connect trick, tunnels/dev-server URLs, aliases/scripts). Put new tricks there, not in the appendix; only add uses verified to be real — no invented tool examples.
- Input is parsed as chunks; newline-terminated lines emit immediately and unterminated input flushes after 100 ms idle (may split a line if a producer pauses). TTY output explicitly uses CRLF so each QR row returns to column 0 even when the terminal doesn't map LF to CRLF. Test via `processInput` with `PassThrough`.
- `EPIPE` is swallowed so `qrcat | head` exits quietly.
- `.ocmux.json` is OpenCode/tmux harness state, not project source.
