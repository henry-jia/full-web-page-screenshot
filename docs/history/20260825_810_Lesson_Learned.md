# Lessons Learned

- Visible-tab capture APIs require viewport tiling; full-page coverage is an orchestration problem, not one API call.
- Stitching must account for device-pixel scale and remainder tiles to avoid seams and silent cropping.
- Page cleanup belongs in an unconditional terminal path because capture permissions and bitmap decoding can fail mid-run.

