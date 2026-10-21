# Ori

Ori is a browser origami studio. Fold a virtual sheet of paper directly in the
browser: drag to fold, watch it settle in 3D, undo and redo, play built-in
presets (crane, cup, plane), and export your model. It runs entirely
client-side; the fold engine runs in a Web Worker and rendering uses Three.js.

## Features

- Interactive folding on a 2D crease pattern with a live 3D view
- Folding engine built on Rabbit Ear, running off the main thread
- Layer ordering and collision checks so folds stay physically valid
- Snapping, fold gestures, keyboard folding, and touch input
- Undo/redo history, autosave, and PNG export
- Preset folds (crane, cup, plane) with step playback
- Accessible UI with a keyboard shortcut sheet

## License

Ori is free software, released under the
[GNU General Public License v3.0](LICENSE) (GPL-3.0-only).

Ori builds on [Rabbit Ear](https://github.com/rabbit-ear/rabbit-ear) by Kraft,
the computational origami library that powers the crease-pattern and folding
geometry. Rabbit Ear is also GPLv3.

## Getting started

Requires Node.js and npm.

```sh
npm install
npm run dev      # start the Vite dev server
npm test         # type-check tests and run vitest
npm run build    # type-check, production build to dist/, then the size gate
npm run e2e      # Playwright end-to-end tests
```

`npm run build` runs a post-build check (`scripts/bundle-size.mjs`) that fails
if the gzipped bundle exceeds 300 KB. `npm run size` runs it on its own.

### Browser for e2e

Playwright uses its own Chromium when the expected revision is installed
(`npx playwright install chromium`). If it is not, `playwright.config.ts`
falls back to a Chromium binary from `ORI_CHROMIUM` (path to the executable),
or auto-detects the newest `chromium-*` build in the Playwright cache:

```sh
ORI_CHROMIUM=/path/to/chromium npm run e2e
```

## Deploy

Ori is a static site deployed to Cloudflare Pages. `wrangler.toml` sets the
project name (`ori`) and output directory (`dist`), and `public/_headers`
sets caching (hashed `/assets/*` are immutable for a year; `index.html` is
`no-cache`) plus basic security headers.

```sh
npx wrangler login
npx wrangler pages project create ori --production-branch main   # once
npm run build
npx wrangler pages deploy dist --project-name ori
```
