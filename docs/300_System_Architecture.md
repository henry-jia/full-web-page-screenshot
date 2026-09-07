# System Architecture

```text
Popup
  -> Background capture coordinator
       -> Content script: measure / prepare / scroll / cleanup
       -> tabs.captureVisibleTab: viewport bitmap
       -> Canvas stitcher: full-page PNG
       -> Downloads API: local file
```

`capture-plan.js` is the deep module: it validates geometry, limits segment budgets, turns document geometry into deterministic capture/source/destination rectangles, and calculates a uniform output-fit profile for Canvas limits. The background coordinator consumes those results without owning tiling arithmetic.

The stitcher tracks two scale spaces. Source scales map CSS coordinates to the full-resolution viewport bitmap; output scales map the same CSS coordinates to the final Canvas. When natural output exceeds the 32,767px dimension or 64,000,000-pixel area budget, only destination placement is uniformly reduced. Every source crop remains full resolution, so the result contains the complete page without silent cropping.

The content script chooses one capture target per session. It uses the window for a substantive document-root scroll range. When root overflow is absent or minor, it scores visible `overflow: auto|scroll` elements and may select a much larger dominant container instead. Container metrics drive the same capture planner, while a capture descriptor records the container's viewport frame and the expanded output canvas size.

For a nested target that reaches the viewport's trailing edges, the stitcher draws the complete first viewport once. For a non-edge frame, it slices the surrounding viewport chrome: leading header/sidebar regions stay in place and trailing right/bottom regions move after the expanded scroll content. Later bitmaps are cropped to the target frame and placed using origin-aware pixel geometry. This avoids overwriting or repeating unrelated viewport chrome.

The selected frame must be fully visible and remain positionally stable throughout capture. Partial clipping fails closed, and every segment reports a fresh descriptor that the background coordinator compares before bitmap capture. For an element target, preparation also disables CSS scroll anchoring. Before each bitmap, the content script makes at most three exact reposition attempts. Position validation accepts at most half a physical pixel plus `0.001` CSS px of floating-point representation noise; transient layout displacement and Firefox subpixel quantization are absorbed, while material or persistent redirection still fails closed. A mismatch reports numeric requested, actual, maximum, mode, attempt-count, and target-connection diagnostics without including page content.

The content script is intentionally stateful only during one capture. It records the original window and target scroll positions plus temporary DOM/style changes in `prepare`. Background orchestration invokes cleanup before success and from every prepared error path; cleanup performs DOM restoration synchronously before returning, without depending on animation frames.

Cleanup restores geometry-affecting scrollbar styles first, restores window/element coordinates while smooth scrolling, anchoring, and snap remain disabled, and only then restores their original inline styles and releases the global capture marker.

Sticky elements are temporarily returned to normal document flow so they appear once at their content position. Fixed elements are included in the first segment and hidden for later segments. Actual scroll coordinates are validated before each bitmap capture.
