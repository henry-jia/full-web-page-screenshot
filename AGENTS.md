# Codex Project Adapter

Claude governance remains the source of truth. Read `CLAUDE.md` in this repository after the global governance files.

Codex-specific notes:

- Keep the extension dependency-free unless a dependency has a demonstrated need.
- Treat `extension/manifest.json` as the packaging root.
- Keep browser-independent capture calculations in `extension/capture-plan.js` and cover them with Node tests.
- Do not add telemetry, remote uploads, or network calls.

