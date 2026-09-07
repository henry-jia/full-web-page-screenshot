# Full Web Page Screenshot Project

## Goal

Build a Firefox WebExtension that captures the complete scrollable area of the active web page and downloads it as a PNG.

## Architecture

- Firefox Manifest V2 WebExtension, using native browser APIs and plain JavaScript.
- `background.js` owns capture orchestration, stitching, and download.
- `content-script.js` owns page measurement, scrolling, temporary capture styles, and state restoration.
- `capture-plan.js` is the deep, browser-independent planning module.

## Project rules

- No data leaves the browser.
- Do not silently crop a page; reject captures that exceed the documented safe canvas budget.
- Always restore page scroll position and temporary DOM changes on success or failure.
- User-facing text is Traditional Chinese; code and identifiers are English.
- Run `npm test` and `npm run check` after code changes.

