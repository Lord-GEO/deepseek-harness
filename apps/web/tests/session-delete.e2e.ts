/** Permanent deletion through the real Session menu and recorded-history reader. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession,
  acknowledgeReloadConnectionLoss, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/session-delete/dialog.expected.md', import.meta.url))

it('confirms deletion, preserves cancellation and other histories, and stays deleted after reload', async () => {
  const scaffold = await launchWebScaffold({})
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const fixture = await readFile(FIXTURE, 'utf8')
    const id = await seedSession(scaffold, fixture, 'delete-history')
    const keep = await seedSession(scaffold, fixture, 'keep-history')
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Deletion workspace')
    await workspace.attachSession(id)
    await workspace.attachSession(keep)
    const title = 'Delete this conversation'
    await scaffold.ctx.sessionController.rename({ sessionId: id, title })
    const page = await newEnglishPage(browser)
    const consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    const row = page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) })
    await row.waitFor({ state: 'visible' })
    await row.click()
    const openDelete = async () => {
      await row.hover()
      await row.getByRole('button', { name: `Session actions for ${title}`, exact: true }).click()
      await page.getByRole('menuitem', { name: 'Delete session', exact: true }).click()
    }
    await openDelete()
    const dialog = page.getByRole('dialog', { name: 'Delete session', exact: true })
    await dialog.waitFor({ state: 'visible' })
    await expect.poll(() => dialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(button => button === document.activeElement)).toBe(true)
    await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await scaffold.ctx.sessionPersistence.stat(id)).toBeDefined()
    await row.waitFor({ state: 'visible' })
    await openDelete()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => dialog.count(), { timeout: 15_000 }).toBe(0)
    await expect.poll(() => row.count(), { timeout: 15_000 }).toBe(0)
    await expect.poll(() => scaffold.ctx.sessionPersistence.stat(id)).toBeUndefined()
    expect(workspace.sessionIds).not.toContain(id)
    expect(await scaffold.ctx.sessionPersistence.stat(keep)).toBeDefined()
    const warningStart = consoleWatch.warnings.length
    await page.reload()
    acknowledgeReloadConnectionLoss(consoleWatch, warningStart)
    await page.getByRole('button', { name: 'View options', exact: true }).waitFor({ state: 'visible' })
    expect(await row.count()).toBe(0)
    const listed = await scaffold.ctx.sessionController.list({}, new AbortController().signal)
    expect(listed.items.map(item => item.sessionId)).not.toContain(SessionId(id))
    expect(consoleWatch.pageErrors).toEqual([])
    expect(consoleWatch.warnings).toEqual([])
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)
