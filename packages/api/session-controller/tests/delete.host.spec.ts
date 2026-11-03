import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  await mountAgentLoopTestHarness(ctx)
  const forgetSession = vi.fn(async () => {})
  ctx.provide('workspaceRegistry', { archivedSessionIds: [], forgetSession } as never)
  const controller = await createSessionTestController(ctx, {
    cwd: root, defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  })
  const seed = async (id: string, parentSession?: SessionId, origin?: 'subagent') => {
    const header: SessionHeader = {
      id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, cwd: root,
      ...parentSession === undefined ? {} : { parentSession },
      ...origin === undefined ? {} : { origin },
    }
    const handle = await ctx.sessionPersistence.create(header)
    await handle.flush()
    await handle.close()
    return header.id
  }
  return { ctx, root, controller, seed, forgetSession }
}

it('deletes inactive subagent descendants before the parent and preserves independent forks', async () => {
  const h = await harness()
  const root = await h.seed('delete-root')
  const child = await h.seed('delete-child', root, 'subagent')
  const grandchild = await h.seed('delete-grandchild', child, 'subagent')
  const fork = await h.seed('keep-fork', root)
  const deleted: SessionId[] = []
  h.ctx.on('api-session/deleted', (id) => { deleted.push(id) })
  await expect(h.controller.delete({ sessionId: root })).resolves.toEqual({ deletedSessionIds: [grandchild, child, root] })
  expect(deleted).toEqual([grandchild, child, root])
  expect(h.forgetSession.mock.calls).toEqual([[grandchild], [child], [root]])
  expect((await h.ctx.sessionPersistence.list()).map(item => item.header.id)).toEqual([fork])
  await expect(h.controller.delete({ sessionId: root })).resolves.toEqual({ deletedSessionIds: [root] })
})

it('rejects active or unauthorized descendants before deleting any log', async () => {
  const h = await harness()
  const root = await h.seed('active-root')
  const child = await h.seed('active-child', root, 'subagent')
  const stop = h.ctx.on('workspace/session-activity', async (request, next) => request.sessionId === child
    ? [{ kind: 'turn', items: [{ id: 'running-turn' }] }]
    : await next())
  await expect(h.controller.delete({ sessionId: root })).rejects.toMatchObject({ code: 'session/delete-active' })
  expect(await h.ctx.sessionPersistence.stat(root)).toBeDefined()
  expect(await h.ctx.sessionPersistence.stat(child)).toBeDefined()
  stop()
  vi.spyOn(h.ctx.remoteAccess, 'allows').mockImplementation(resource => resource.kind !== 'session' || resource.id !== child)
  await expect(h.controller.delete({ sessionId: root })).rejects.toMatchObject({ code: 'session/delete-denied' })
  expect(await h.ctx.sessionPersistence.stat(root)).toBeDefined()
  expect(await h.ctx.sessionPersistence.stat(child)).toBeDefined()
})

it('retries metadata cleanup using deleted identities without removing unrelated stored histories', async () => {
  const h = await harness()
  const root = await h.seed('cleanup-root')
  const child = await h.seed('cleanup-child', root, 'subagent')
  const keep = await h.seed('cleanup-keep')
  h.forgetSession.mockRejectedValueOnce(new Error('storage temporarily unavailable'))
  await expect(h.controller.delete({ sessionId: root })).rejects.toMatchObject({
    code: 'session/delete-failed', details: { deletedSessionIds: [child, root] },
  })
  const retried = await h.controller.delete({ sessionId: root, cleanupSessionIds: [child, root] })
  expect(retried.deletedSessionIds).toEqual(expect.arrayContaining([child, root]))
  await expect(h.controller.delete({ sessionId: root, cleanupSessionIds: [keep] })).rejects.toMatchObject({
    code: 'session/delete-denied',
  })
  expect(await h.ctx.sessionPersistence.stat(keep)).toBeDefined()
})
