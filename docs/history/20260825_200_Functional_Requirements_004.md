# Functional Requirements

The MVP contract is [REQ-20260825-001](requirements/REQ-20260825-001.md).

- Start a full-page capture from the browser-action popup.
- Measure, scroll, capture, and stitch every page segment.
- Automatically capture the dominant in-page scroll container when the document root itself does not scroll, while preserving the surrounding viewport in the first segment.
- Preserve complete page coverage for oversized output by uniformly downscaling the final PNG to the safe Canvas dimension and pixel-area budget instead of rejecting or cropping it.
- Download a locally generated PNG with a safe filename.
- Report progress, completion, and actionable failures.
- Restore the page after every terminal outcome.

## Implementation status

All listed MVP functions are implemented. Automated coverage includes document scrolling, nested-container scrolling, frame-aware stitching, adaptive large-page output, cleanup, and failure paths. The corrected nested-scroller and oversized-output paths still require a final Firefox retest on the reported page.
