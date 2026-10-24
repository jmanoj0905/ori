// End-to-end, accessibility, visual and performance gates (Plan 2, Task 13).
//
// The app under test is the production build made in e2e mode
// (`npm run build:e2e` → dist-e2e/, `vite build --mode e2e`): identical to the
// shipped bundle except that `.env.e2e` sets VITE_ORI_E2E=1, which exposes the
// `window.__ori` test hook (store, stage, ui, settings). The shipped build
// (`npm run build`) has no hook; `npm run size` checks that.
//
// Browser: Playwright's own Chromium. If its expected revision is not installed
// (`npx playwright install chromium` could not run), set ORI_CHROMIUM to a
// Chromium binary, or the newest chromium-* build in the Playwright cache
// (PLAYWRIGHT_BROWSERS_PATH or the per-OS default) is used.
import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { chromium, defineConfig, devices } from '@playwright/test'

const PORT = 4317

function cacheDir(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright')
  return join(homedir(), '.cache', 'ms-playwright')
}

/** Binary inside a chromium-<rev> cache directory, per OS. */
function binaryIn(dir: string): string | undefined {
  const candidates =
    platform() === 'darwin'
      ? ['chrome-mac-arm64', 'chrome-mac'].flatMap(d => [
          join(dir, d, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          join(dir, d, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        ])
      : platform() === 'win32'
        ? [join(dir, 'chrome-win64', 'chrome.exe'), join(dir, 'chrome-win', 'chrome.exe')]
        : [join(dir, 'chrome-linux64', 'chrome'), join(dir, 'chrome-linux', 'chrome')]
  return candidates.find(existsSync)
}

/** undefined: Playwright's default browser is installed and is used as is. */
function chromiumPath(): string | undefined {
  if (process.env.ORI_CHROMIUM) return process.env.ORI_CHROMIUM
  try {
    if (existsSync(chromium.executablePath())) return undefined
  } catch {
    /* fall through to the cache scan */
  }
  const root = cacheDir()
  if (!existsSync(root)) return undefined
  const revs = readdirSync(root)
    .map(d => /^chromium-(\d+)$/.exec(d))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
  for (const m of revs) {
    const bin = binaryIn(join(root, m[0]))
    if (bin) return bin
  }
  return undefined
}

const executablePath = chromiumPath()

export default defineConfig({
  testDir: 'e2e',
  // One worker: the perf gate must not share the CPU, and the specs are quick.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // GPU / rasteriser noise between runs (anti-aliased edges, washi grain).
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  // Baselines are per OS and project: other platforms record their own (GPU and font
  // rasterisation differ) instead of failing against another machine's PNGs.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{testFilePath}/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // Real GPU rasterisation where available (the perf gate measures WebGL frames).
      // WebGPU for the soft-paper solver's specs (e2e/soft.spec.ts); they skip where there is no adapter.
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'],
    },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `npm run build:e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
