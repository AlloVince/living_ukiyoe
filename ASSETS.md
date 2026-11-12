# Assets & provenance

## Artwork

Katsushika Hokusai, *Under the Wave off Kanagawa*, ca. 1830–32, The Metropolitan Museum of Art, **JP2569**, The Howard Mansfield Collection, Purchase, Rogers Fund, 1936.

- Museum record: https://www.metmuseum.org/art/collection/search/39799
- Public Domain scan: https://images.metmuseum.org/CRDImages/as/original/DP141042.jpg
- Scan SHA-256 recorded on acquisition: `b410eeec0473c4e63eef12434a5a7c4613401c6e18670718d7727f36a441495c`.

## Vector trace

The scene was vectorized from the Met scan using a separate third-party trace:

- Source and drawing process: https://wp270302.wpx.jp/Hokusai/drawing-process.html
- The source page identifies the underlying Met work as Public Domain.
- The raw trace SVG is not included in this repository. Its dimensions, path count and SHA-256 are recorded in `assets/source/kanagawa-vector-manifest.json`, so it can be re-obtained from the source page and verified.
- The runtime plates in `assets/generated/` were prepared by this project from that trace. `assets/provenance.json` records their SHA-256 hashes.

## Independently sourced inscription

`assets/source/kanagawa-inscription-scan.webp` is a lossless crop from the Met Public Domain scan, after Lanczos resize to 2800×1914; crop bounds `(55,115,312,640)`. `assets/generated/inscription.webp` places that crop at the original coordinates. This scan-derived layer has a documented museum source independent of the third-party trace. It is hidden by default.

## Inventory

`assets/provenance.json` records the exact file hashes and source categories. `pnpm provenance` refreshes this inventory only; it never rewrites the visual baselines.

## Code

Project-authored code uses MIT (LICENSE). Three.js 0.187.0 is MIT; its full notice is copied into the production build. Build/test dependencies and their complete license texts are listed in `licenses/THIRD-PARTY-NOTICES.txt`. No web font, music, online AI output or external code from the trace page is loaded into this standalone runtime.
