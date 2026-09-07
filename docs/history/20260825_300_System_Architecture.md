# System Architecture

```text
Popup
  -> Background capture coordinator
       -> Content script: measure / prepare / scroll / cleanup
       -> tabs.captureVisibleTab: viewport bitmap
       -> Canvas stitcher: full-page PNG
       -> Downloads API: local file
```

`capture-plan.js` is the deep module: it validates dimensions and turns document geometry into deterministic segments. The background coordinator consumes that plan without owning tiling arithmetic.

The content script is intentionally stateful only during one capture. It records the original scroll position and temporary DOM changes in `prepare`, then `cleanup` restores them through a `finally` path.

