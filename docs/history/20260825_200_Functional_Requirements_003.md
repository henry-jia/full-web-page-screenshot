# Functional Requirements

The MVP contract is [REQ-20260825-001](requirements/REQ-20260825-001.md).

- Start a full-page capture from the browser-action popup.
- Measure, scroll, capture, and stitch every page segment.
- Automatically capture the dominant in-page scroll container when the document root itself does not scroll, while preserving the surrounding viewport in the first segment.
- Download a locally generated PNG with a safe filename.
- Report progress, completion, and actionable failures.
- Restore the page after every terminal outcome.

## Implementation status

All listed MVP functions are implemented. Automated coverage includes document scrolling, nested-container scrolling, frame-aware stitching, cleanup, and failure paths. The corrected nested-scroller path still requires one final Firefox retest on the reported page.
