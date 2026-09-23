# Full Web Page Screenshot for Firefox

[繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

Capture an entire web page—including content inside the page's main scrollable container—and download it as one PNG. Processing stays inside Firefox; no screenshot or page data is uploaded.

## Features

- Captures pages that scroll vertically, horizontally, or in both directions.
- Detects the dominant in-page scroll container used by modern web applications.
- Warms up lazy-loaded content before capture.
- Avoids duplicating fixed and sticky elements across stitched segments.
- Downscales exceptionally large output to Firefox-safe canvas limits without cropping content.
- Restores scroll position and temporary page styles after success or failure.
- Shows capture progress and actionable error diagnostics in Traditional Chinese.

## Privacy

The extension has no server, analytics, telemetry, account, or remote service. Page pixels are processed locally and the final PNG is saved through Firefox's Downloads API. See [PRIVACY.md](PRIVACY.md).

Permissions:

- `activeTab`: access the current page only after the user clicks the extension.
- `downloads`: save the completed PNG locally.

## Requirements

- Firefox 142 or newer
- Node.js 20 or newer only for development and tests
- PowerShell 7 for the release build script

## Install

### Firefox Add-ons

Install the latest version from the public AMO listing: [Full Web Page Screenshot](https://addons.mozilla.org/en-US/firefox/addon/full-web-page-screenshot/). AMO installs are signed by Mozilla, survive browser restarts, and update automatically.

Alternatively, install the signed XPI attached to a GitHub Release (version 0.1.0 was signed through the AMO self-distribution channel, 2026-09-07).

### Temporary development install

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on**.
3. Choose `extension/manifest.json`.
4. Open a regular web page, click the extension icon, then select **擷取完整頁面**.

Temporary installations are removed when Firefox restarts.

### GitHub Release artifacts

The release ZIP is the deterministic package submitted to Mozilla. Standard Firefox Release and Beta builds require a Mozilla-signed XPI; do not rename the unsigned ZIP to `.xpi`. The Mozilla-signed XPI from the AMO self-distribution channel is attached to the matching GitHub Release.

## Build

```powershell
npm run build
```

This creates the following ignored artifacts under `dist/`:

- `full-web-page-screenshot-<version>.zip`
- `full-web-page-screenshot-<version>.zip.sha256`

The ZIP contains `manifest.json` at its root, as required by AMO.

## Verify

```powershell
npm test
npm run check
```

The current suite contains 37 automated tests covering capture planning, stitching, browser coordination, nested scrollers, cleanup, oversized pages, and fractional Firefox scroll positions.

## Project structure

```text
extension/              Firefox extension package root
scripts/                Deterministic release packaging
tests/                  Node.js automated tests
docs/                   Requirements, architecture, test, and release docs
```

## Known limitations

- Firefox internal pages, AMO pages, and other protected pages do not allow content-script capture.
- Animations, video, WebGL, and continuously changing content can show different moments across segments.
- If a page has several independent large scroll areas, only the dominant one is fully expanded.
- Pages that continuously override requested scroll positions are stopped to prevent blank or missing regions.
- Extremely large pages requiring more than 500 viewport segments are rejected to avoid locking the browser.

## Release and store metadata

- [Release and AMO procedure](docs/600_Deployment.md)
- [Prepared AMO listing copy](docs/AMO_LISTING.md)
- Firefox add-on ID: `full-web-page-screenshot@henry-jia.github.io`

## License

[Mozilla Public License 2.0](LICENSE)
