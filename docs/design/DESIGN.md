# Full Web Page Screenshot — Design System

Direction: **Tech Utility**. Surface: compact browser-extension popup. Audience: desktop Firefox users. Tone: precise, calm, local-first. Brand assets: new project, no inherited logo.

## 1. Color

- `--color-surface-base: oklch(0.12 0.01 250)` — popup canvas.
- `--color-surface-raised: oklch(0.17 0.012 250)` — controls and status regions.
- `--color-text-primary: oklch(0.94 0.01 250)` — primary copy.
- `--color-text-muted: oklch(0.72 0.02 250)` — supporting copy.
- `--color-action-primary: oklch(0.72 0.17 145)` — capture action and progress.
- `--color-action-ink: oklch(0.13 0.03 145)` — text on primary action.
- `--color-state-danger: oklch(0.68 0.19 28)`.
- `--color-state-success: oklch(0.76 0.15 150)`.
- `--color-hairline: oklch(0.92 0.01 250 / 0.1)`.

## 2. Typography

- Display: `"JetBrains Mono", "SFMono-Regular", Consolas, monospace`.
- Body: `"IBM Plex Sans", "Noto Sans TC", system-ui, sans-serif`.
- Mono: `"JetBrains Mono", "SFMono-Regular", Consolas, monospace`.
- Scale: 12px metadata / 14px controls / 16px body / 24px title, on an 8px baseline rhythm.

## 3. Spacing

- Tokens: 4px optical micro-gap; 8px, 16px, 24px, and 32px layout spacing.
- Popup padding is 24px; dense status rows use 12px vertical padding.

## 4. Layout

- Fixed 360px popup width with a single left-aligned column.
- Primary action spans the available width; progress and help follow in reading order.
- No responsive breakpoint is needed inside the browser-action popup.

## 5. Components

- Capture button: solid primary color; darker hover; 2px focus outline; 1px active translation; disabled state lowers saturation; loading state uses progress text rather than a spinner.
- Status panel: neutral default; green success hairline; red error hairline; concise empty copy before capture.
- Progress bar: determinate width when segment count is known; hidden in idle and terminal states.

## 6. Motion

- `--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1)`.
- Button and progress transitions run for 160ms; reduced-motion users receive no transition.

## 7. Voice

- Direct and specific: “正在擷取第 3 / 8 段” rather than generic “處理中”。
- Errors state the boundary and next action: “Firefox 不允許擷取這個頁面；請改用一般網站分頁。”

## 8. Brand

- Point of view: full-page capture should feel like a local utility, not a cloud product.
- Attributes: precise, quiet, trustworthy.
- Anti-attributes: playful, promotional, ornamental.

## 9. Anti-patterns

- No gradients, glassmorphism, decorative emoji, stock illustrations, or spinner.
- No uniform 16px rounding; buttons use 4px and panels use 2px.
- No generic SaaS copy, fake data, remote fonts, analytics, or hidden uploads.
- No color or spacing outside the tokens above without updating this document first.

## Delivery critique

- Philosophy 9/10 — the local utility point of view is explicit.
- Hierarchy 9/10 — one primary job dominates the small surface.
- Detail 8/10 — progress language and hairlines are purpose-designed.
- Function 10/10 — every element serves capture, progress, or recovery.
- Innovation 7/10 — page-segment notation gives the utility a specific identity.
- Total: 43/50. Senior-design review target: pass.

