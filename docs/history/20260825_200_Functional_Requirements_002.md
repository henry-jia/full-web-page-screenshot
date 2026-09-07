# Functional Requirements

The MVP contract is [REQ-20260825-001](requirements/REQ-20260825-001.md).

- Start a full-page capture from the browser-action popup.
- Measure, scroll, capture, and stitch every page segment.
- Download a locally generated PNG with a safe filename.
- Report progress, completion, and actionable failures.
- Restore the page after every terminal outcome.

## Implementation status

All listed MVP functions are implemented. The browser-independent capture planner has automated coverage; the end-to-end Firefox smoke test remains a local manual verification step because it requires an interactive browser window and a real page.
