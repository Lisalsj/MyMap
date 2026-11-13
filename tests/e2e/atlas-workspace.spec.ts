import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'

test('atlas controls sort trips, open search results by keyboard, and keep drafts through focused writing', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'mymap-atlas-workspace-'))
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)
    ),
    MYMAP_TEST_ROOT: root,
    MYMAP_TEST_HEADLESS: '1',
    MYMAP_DEMO: '1'
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? [] : [resolve('out/main/index.js')],
    env
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '我的旅行', exact: true }).click()
    const collection = page.getByRole('region', { name: '旅行目录' })
    await expect(collection.locator('.trip-card').first()).toContainText('秋天的远行')
    await page.getByRole('button', { name: '目录布局', exact: true }).click()
    await expect(collection.locator('.trip-grid')).toHaveClass(/collection-list/)
    await expect(page.getByRole('button', { name: '目录布局', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByLabel('旅行排序', { exact: true }).selectOption('title')
    const titles = await collection.locator('.trip-card-title').allTextContents()
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'zh-CN')))

    await page.keyboard.press('Control+k')
    const search = page.getByRole('textbox', { name: '搜索旅行、地点、手记和标签' })
    await search.fill('江南')
    await search.press('ArrowDown')
    await expect(page.locator('.search-results .is-current')).toContainText('江南')
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await search.press('Enter')
    await expect(page.getByRole('heading', { name: '江南，慢一点', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
    await expect(page.locator('.search-results')).toHaveCount(0)

    await page.getByRole('button', { name: '清空搜索', exact: true }).click()
    await page.getByRole('button', { name: '我的旅行', exact: true }).click()
    await expect(page.getByRole('button', { name: '目录布局', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByLabel('旅行排序', { exact: true })).toHaveValue('title')
    await page.getByRole('button', { name: '旅行手账', exact: true }).click()
    await page.locator('.entry-item').first().click()
    const body = page.getByRole('textbox', { name: 'Markdown 游记正文' })
    await body.fill('专注模式中的草稿，应保留在同一篇手记。')
    await page.getByRole('button', { name: '专注书写', exact: true }).click()
    await expect(page.locator('.journal-index')).toBeHidden()
    await expect(body).toHaveValue('专注模式中的草稿，应保留在同一篇手记。')
    await page.keyboard.press('Escape')
    await expect(page.locator('.journal-index')).toBeVisible()
    await expect(page.getByRole('button', { name: '专注书写', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.myMap.snapshot())).entries.some(
          (e) => e.markdown === '专注模式中的草稿，应保留在同一篇手记。'
        )
      )
      .toBe(true)
    await page.getByLabel('照片所属旅行', { exact: true }).selectOption('')
    await page.getByRole('button', { name: '紧凑照片', exact: true }).click()
    await expect(page.locator('.photo-grid')).toHaveClass(/photo-grid-compact/)
    await page.getByLabel('照片排序', { exact: true }).selectOption('recent')
    await expect(page.locator('.photo-tile')).toHaveCount(3)
    await page.keyboard.press('Control+n')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '旅行护照', exact: true }).click()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await expect(page.getByRole('button', { name: '紧凑照片', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByLabel('照片排序', { exact: true })).toHaveValue('recent')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(320, 600))
    for (const width of [1024, 768, 390, 320]) {
      await app.evaluate(
        ({ BrowserWindow }, value) =>
          BrowserWindow.getAllWindows()[0].setBounds({ width: value, height: 900 }),
        width
      )
      for (const name of ['足迹地图', '我的旅行', '旅行手账', '照片馆', '旅行护照', '设置与资料库']) {
        await page.getByRole('button', { name, exact: true }).first().click()
        await page.waitForTimeout(100)
        const overflow = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth
        }))
        expect(overflow.scroll, `${name} at ${width}px`).toBeLessThanOrEqual(overflow.width + 1)
      }
    }
  } finally {
    await app.close()
    const verifiedRoot = realpathSync(root)
    if (
      dirname(verifiedRoot) !== realpathSync(tmpdir()) ||
      !basename(verifiedRoot).startsWith('mymap-atlas-workspace-')
    )
      throw Error('Unexpected fixture cleanup path')
    rmSync(verifiedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
