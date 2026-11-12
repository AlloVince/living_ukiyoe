# Standalone engineering notes

## Sources and ownership

Node.js 24, pnpm 11.1.2; this repository is its own workspace and lockfile boundary. `scripts/build.mjs` resolves local esbuild and Three.js, supplies embedded texture plates via an in-memory module, and writes `dist/`. It does not create or delete temporary source files. `pnpm check` confirms real dependency paths stay inside this directory and that build inputs do not reach outside it. Original scene and texture hashes are mandatory checks.

This is a retained Three.js / native HTML application, not a new React/MUI host. The existing renderer and controls were kept native to avoid introducing a second UI runtime into the standalone artwork. It does not import Cloveread’s theme, MUI packages or global CSS. Interface regions have stable `WaveLab.Artwork`, `WaveLab.PanelHead`, `WaveLab.Controls` and `WaveLab.PanelFoot` component IDs. There is no page header or footer: the artwork owns the window and the right panel is the only chrome. Its head row carries the title, a share icon and a language icon with a small menu; the row below holds Reload and the Play/Pause toggle; the credits page link and the Live Demo link sit in the panel foot. Visible prose is limited to control labels, option labels and button text — there is no subtitle, hint, version note or artwork caption. No production debug panel, source locator or diagnostic guide is exposed.

`app/style.css` owns the local typography and spacing tokens. Display headings use a system serif stack; UI/body use system sans with CJK fallbacks; values use tabular numerals. UI roles are 14px body, 12px captions and a compact 1.05rem panel title. Native controls have at least 44px button/checkbox-row targets. The artwork fills the viewport height beside a 21rem panel; below 900px the complete artwork precedes the natural-height document panel, which then scrolls with the page. Artwork is never covered by controls.

The panel has no labelled collapse button. Following the splitter convention of code editors and design tools, the vertical divider is the control: drag it between 264 and 440px, drag it below the threshold, double-click it, or press Enter on it to close, and the slim grip left at the right edge reopens it by click or drag. Arrow keys resize a focused divider. Width and collapsed state persist in localStorage. V5 opens on the complete print; Radio’s pigment-box cover stays available in the Composition select.

## Visual baseline

`evidence/baseline/` was captured before product UI changes from the accepted legacy Demo at 1440×925 / DPR 1, motion enabled and paused at 0 / 7 / 14 / 21 / 27.99 seconds. `reduced-motion.png` is the complete still from the same renderer. Its manifest protects original texture bytes, motion modules, scene algorithm, defaults and 28-second loop. Baselines are immutable; build and e2e never regenerate them. Changing the approved artwork requires a separate Owner decision.

E2E briefly sets only the canvas container to the reference dimensions to compare pixels independently of the new page layout. All responsive screenshots and interactions use the production layout. Portable GPU runs report pixel differences, because another GPU/browser build may rasterize identical code differently; they cannot be called exact visual acceptance.

## Repository contents

This repository is the standalone export of the accepted Wave Lab. It contains the production scene modules, prepared runtime plates, visual baseline, build/test scripts, licenses, provenance records and a trace manifest (source URL, dimensions, path count and SHA-256). The raw third-party trace SVG is not redistributed here; the build does not read it. Task notes, rejected references, review captures, historical bundles and the Python extraction scratch workspace are not part of the repository. `node_modules/`, `dist/`, `.cache/` and current test evidence are local outputs and are ignored.

The historical Python extraction pipeline is not the supported application build. The retained runtime plates are the build source of truth. Minimum supported production/media commands are in package.json. The only source scan used independently of the trace is the Met inscription crop; recording a museum scan license does not clear the texture plates.

## GitHub Pages

`.github/workflows/pages.yml` is manual-only (`workflow_dispatch`). It installs dependencies, builds, runs `pnpm check && pnpm test`, installs Chromium, runs `pnpm e2e`, and uploads `dist/`. The standalone app supports a project subpath using relative resource links rather than a hardcoded hostname.

## Additional local commands

`BASE_PATH=/living_ukiyoe/ pnpm preview` serves the existing build at `http://127.0.0.1:4177/living_ukiyoe/`. Default dev/preview uses port 4177 and `/`; override PORT when needed. The browser tests choose an available port and start/stop their own server.

`pnpm measure` opens an installed Google Chrome window and records GPU identity and frame timings in `evidence/current/performance-chrome.json`. It is an optional local observation, not a device-independent performance guarantee.

`pnpm showcase` uses FFmpeg to make `media/living-ukiyoe.gif` from the actual production canvas recording produced by E2E. The compact GIF is a presentation export at 480px / 6fps; the runtime retains the full approved texture data.
