# System Architecture

```text
Popup
  -> Background capture coordinator
       -> Content script: measure / prepare / scroll / cleanup
       -> tabs.captureVisibleTab: viewport bitmap
       -> Canvas stitcher: full-page PNG
       -> Downloads API: local file
```

`capture-plan.js` is the deep module: it validates dimensions, limits pixel/segment budgets, and turns document geometry into deterministic capture, source-crop, and destination rectangles. The background coordinator consumes those rectangles without owning tiling arithmetic.

The content script is intentionally stateful only during one capture. It records the original scroll position and temporary DOM changes in `prepare`. Background orchestration invokes cleanup before success and from every prepared error path; cleanup performs DOM restoration synchronously before returning, without depending on animation frames.

Sticky elements are temporarily returned to normal document flow so they appear once at their content position. Fixed elements are included in the first segment and hidden for later segments. Actual scroll coordinates are validated before each bitmap capture.
