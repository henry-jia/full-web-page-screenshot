# Function List

| Function | Surface | Status |
|---|---|---|
| Start complete-page capture | Popup | Implemented |
| Plan viewport segments | Capture core | Implemented and tested |
| Detect root or dominant nested scroll target | Content script | Implemented and tested |
| Stabilize transient anchoring, lazy-layout displacement, and Firefox subpixel scroll offsets | Content script | Implemented and tested; bounded to 3 attempts and half a physical pixel |
| Prepare and restore page | Content script | Implemented and tested; Firefox retest pending |
| Stitch document or nested scroll frame into PNG | Background | Implemented and tested; Firefox retest pending |
| Fit oversized output to safe Canvas budget | Capture core / Background | Implemented and tested; preserves full coverage |
| Download locally | Background | Implemented; manual smoke pending |
| Report progress, failures, and safe numeric scroll diagnostics | Popup | Implemented and tested |
