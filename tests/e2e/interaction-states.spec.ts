import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const test = base.extend<{ app: ElectronApplication; appPage: Page }>({
  app: async ({}, use) => {
    const parent = realpathSync(tmpdir())
    const prefix = 'mymap-interaction-states-'
    const root = mkdtempSync(join(parent, prefix))
    let app: ElectronApplication | undefined
    try {
      const env = Object.fromEntries(
        Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
      )
      delete env.ELECTRON_RUN_AS_NODE
      app = await electron.launch({
        executablePath: process.env.MYMAP_EXECUTABLE || undefined,
        args: process.env.MYMAP_EXECUTABLE
          ? ['--disable-gpu']
          : [resolve('out/main/index.js'), '--disable-gpu'],
        env: { ...env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '1' },
        timeout: 40000
      })
      await use(app)
    } finally {
      await app?.close().catch(() => {})
      if (dirname(resolve(root)) !== parent || !basename(root).startsWith(prefix))
        throw new Error('Invalid interaction fixture cleanup')
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
  appPage: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForFunction(async () => (await window.myMap.snapshot()).trips.length >= 3)
    await expect(page.getByRole('button', { name: '新建旅行', exact: true }).first()).toBeVisible()
    await use(page)
  }
})

async function holdPointer(page: Page, target: Locator, check: () => Promise<void>) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('The pressed control has no visible bounds')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  try {
    expect(await target.evaluate((element) => element.matches(':active'))).toBe(true)
    await target.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await check()
  } finally {
    // Release outside the control so inspecting its pressed state never activates its action.
    await page.mouse.move(1, 1)
    await page.mouse.up()
  }
}

for (const kind of ['global', 'gallery'] as const) {
  test(`${kind} search shows one focus treatment around the whole field`, async ({ appPage: page }) => {
    let input: Locator
    let wrapper: Locator
    if (kind === 'global') {
      await page.keyboard.press('Control+k')
      input = page.getByRole('textbox', { name: '搜索旅行、地点、手记和标签' })
      wrapper = page.locator('.global-search')
    } else {
      await page.getByRole('button', { name: '照片馆', exact: true }).click()
      input = page.getByRole('textbox', { name: '搜索照片说明' })
      wrapper = page.locator('.gallery-search .input-icon')
      await input.focus()
    }
    await expect(input).toBeFocused()
    const wholeFieldHasFocusTreatment = await wrapper.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none'
    })
    expect(wholeFieldHasFocusTreatment).toBe(true)
    await expect(wrapper).toHaveCSS('outline-style', 'solid')
    expect(
      parseFloat(await wrapper.evaluate((element) => getComputedStyle(element).outlineWidth))
    ).toBeGreaterThanOrEqual(1.5)
    await expect(input).toHaveCSS('outline-style', 'none')
    await expect(input).toHaveCSS('box-shadow', 'none')
  })
}

test('cards keep their own pressed feedback when motion is enabled', async ({ appPage: page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (const control of [
    { navigation: '我的旅行', selector: '.trip-card', transform: 'matrix(0.98, 0, 0, 0.98, 0, 0)' },
    { navigation: '旅行护照', selector: '.city-stamp', transform: 'matrix(0.98, 0, 0, 0.98, 0, 0)' },
    { navigation: '照片馆', selector: '.photo-tile', transform: 'matrix(1, 0, 0, 1, 0, 0)' }
  ]) {
    await page.getByRole('button', { name: control.navigation, exact: true }).click()
    const target = page.locator(control.selector).first()
    await holdPointer(page, target, async () => {
      await expect.soft(target).toHaveCSS('transform', control.transform)
    })
  }
})

test('reduced motion keeps buttons and cards still while hovering and pressing', async ({
  appPage: page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const generic = page.getByRole('button', { name: '新建旅行', exact: true }).first()
  await holdPointer(page, generic, async () => {
    await expect.soft(generic).toHaveCSS('transform', 'none')
  })
  for (const control of [
    { navigation: '我的旅行', selector: '.trip-card' },
    { navigation: '旅行护照', selector: '.city-stamp' },
    { navigation: '照片馆', selector: '.photo-tile' }
  ]) {
    await page.getByRole('button', { name: control.navigation, exact: true }).click()
    const target = page.locator(control.selector).first()
    await target.hover()
    await expect.soft(target).toHaveCSS('transform', 'none')
    await holdPointer(page, target, async () => {
      await expect.soft(target).toHaveCSS('transform', 'none')
    })
  }
})

test('closing a location picked on the SVG returns keyboard focus to the map', async ({ appPage: page }) => {
  await page.getByRole('button', { name: '我的旅行', exact: true }).click()
  await page.locator('.trip-card').filter({ hasText: '江南，慢一点' }).click()
  const map = page.locator('.footprint-map')
  await expect(map).toHaveAttribute('aria-busy', 'false')
  await map.getByRole('button', { name: '地图选点', exact: true }).click()
  const svg = map.locator(':scope > svg')
  await svg.focus()
  await expect(svg).toBeFocused()
  const box = await svg.boundingBox()
  if (!box) throw new Error('The map has no visible bounds')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Read the browser's real focus target before pointerup opens the editor. Depending on
  // the picked pixel, it may be the SVG itself or a focusable city path inside it.
  const origin = await page.evaluateHandle(() => document.activeElement)
  expect(await origin.evaluate((element) => element instanceof SVGElement)).toBe(true)
  await page.mouse.up()
  const dialog = page.getByRole('dialog', { name: '把一个地方，放进回忆' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input[name="lat"]')).not.toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => origin.evaluate((element) => document.activeElement === element)).toBe(true)
})
