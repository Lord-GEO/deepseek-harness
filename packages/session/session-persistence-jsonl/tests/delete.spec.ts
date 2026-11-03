import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlPersistence from '../src/index.ts'
import { generationLogPath, sessionDir } from '../src/format.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { expect, it, onTestFinished } from 'vitest'

it.each(['none', 'zstd'] as const)('deletes every generation with compression %s while preserving other sessions', async (compression) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delete-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(JsonlPersistence, { root, compression })
  const target = meta('delete-target', root)
  const sibling = meta('keep-target', root)
  for (const header of [target, sibling]) {
    const handle = await ctx.sessionPersistence.create(header)
    await handle.append(oneTurnLog())
    await handle.close()
  }
  const current = generationLogPath(root, root, target.id, target.version, compression)
  const older = generationLogPath(root, root, target.id, target.version - 1, compression)
  await writeFile(older, await readFile(current))
  const deleted: string[] = []
  ctx.on('session-persistence/deleted', (id) => { deleted.push(id) })
  await ctx.sessionPersistence.delete(target.id)
  expect(await ctx.sessionPersistence.stat(target.id)).toBeUndefined()
  expect((await ctx.sessionPersistence.list()).map(item => item.header.id)).toEqual([sibling.id])
  expect((await readdir(sessionDir(root, root, target.id))).filter(name => name.includes('.jsonl'))).toEqual([])
  expect(deleted).toEqual([target.id])
  await expect(ctx.sessionPersistence.delete(target.id)).resolves.toBeUndefined()
  expect(deleted).toEqual([target.id])
})

it('refuses an owned log across backend instances and releases deletion ownership afterwards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delete-owned-'))
  const first = new Context()
  const second = new Context()
  onTestFinished(async () => {
    await Promise.all([first.fiber.dispose(), second.fiber.dispose()])
    await rm(root, { recursive: true, force: true })
  })
  await first.plugin(JsonlPersistence, { root, compression: 'none' })
  await second.plugin(JsonlPersistence, { root, compression: 'none' })
  const id = SessionId('owned-delete')
  const writer = await first.sessionPersistence.create(meta(id))
  await expect(first.sessionPersistence.delete(id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
  await writer.flush()
  const child = await second.sessionPersistence.create(meta('owned-child'))
  await child.flush()
  await child.close()
  await expect(second.sessionPersistence.deleteMany([child.id, id])).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
  expect(await second.sessionPersistence.stat(child.id)).toBeDefined()
  await expect(second.sessionPersistence.delete(id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
  expect(await second.sessionPersistence.stat(id)).toBeDefined()
  await writer.close()
  await second.sessionPersistence.delete(id)
  expect(await first.sessionPersistence.stat(id)).toBeUndefined()
  const replacement = await second.sessionPersistence.create(meta(id))
  await replacement.close()
})
