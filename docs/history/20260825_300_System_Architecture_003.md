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

The content script chooses one capture target per session. It uses the window when the document root has a scroll range; otherwise it scores visible `overflow: auto|scroll` elements and selects the dominant container. Container metrics drive the same capture planner, while a capture descriptor records the container's viewport frame and the expanded output canvas size.

For a nested target that reaches the viewport's trailing edges, the stitcher draws the complete first viewport once. For a non-edge frame, it slices the surrounding viewport chrome: leading header/sidebar regions stay in place and trailing right/bottom regions move after the expanded scroll content. Later bitmaps are cropped to the target frame and placed using origin-aware pixel geometry. This avoids overwriting or repeating unrelated viewport chrome.

The selected frame must be fully visible and remain positionally stable throughout capture. Partial clipping fails closed, and every segment reports a fresh descriptor that the background coordinator compares before bitmap capture.

The content script is intentionally stateful only during one capture. It records the original window and target scroll positions plus temporary DOM/style changes in `prepare`. Background orchestration invokes cleanup before success and from every prepared error path; cleanup performs DOM restoration synchronously before returning, without depending on animation frames.

Cleanup restores geometry-affecting scrollbar styles first, restores window/element coordinates while smooth scrolling and snap remain disabled, and only then releases motion/snap styles and the global capture marker.

Sticky elements are temporarily returned to normal document flow so they appear once at their content position. Fixed elements are included in the first segment and hidden for later segments. Actual scroll coordinates are validated before each bitmap capture.
