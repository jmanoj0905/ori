// The 3D view's failure states (final review item 3): a lost WebGL context is
// announced calmly, folding is off meanwhile, and on restore the Stage draws
// again and folding works.
import { expect, test } from '@playwright/test'
import { drag, expectSteps, openStudio } from './helpers'

test('a lost WebGL context is reported, then restored and folding works again', async ({ page }) => {
  await openStudio(page)
  const lose = () =>
    page.evaluate(() => {
      const c = window.__ori!.stage.canvas
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext
      const ext = gl.getExtension('WEBGL_lose_context')!
      ;(window as unknown as { __lose: WEBGL_lose_context }).__lose = ext
      ext.loseContext()
    })
  await lose()
  await expect(page.getByRole('alert')).toHaveText('The 3D view was interrupted. Restoring it…')
  await expect(page.getByRole('button', { name: 'Turn over' })).toBeDisabled()
  await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext())
  await expect(page.getByRole('alert')).toHaveCount(0)
  await drag(page, [0.99, 0.5], [0, 0.5])
  await expectSteps(page, 1)
})
