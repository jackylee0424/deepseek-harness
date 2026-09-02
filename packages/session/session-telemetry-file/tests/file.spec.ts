/**
 * File backend unit tier: per-session JSONL files through the seam's real
 * live coordinator, the ops shutdown marker closing a session's file,
 * default root resolution, unsafe-id and unscoped file stems, load-time
 * misconfiguration, and contained write failures.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'
import FileSessionTelemetryBackend, { DEFAULT_ROOT_DIR_NAME, UNSCOPED_FILE_STEM, type Config } from '../src/index.ts'

const temps: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-telemetry-file-'))
  temps.push(dir)
  return dir
}

async function boot(config: Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(FileSessionTelemetryBackend, config)
  return { ctx, fiber, backend: ctx.sessionTelemetry as FileSessionTelemetryBackend }
}

function records(path: string): SessionTelemetryRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as SessionTelemetryRecord)
}

describe('FileSessionTelemetryBackend', () => {
  it('appends each session\'s records to its own JSONL file and completes it with the shutdown marker', async () => {
    const root = join(temp(), 'nested', 'telemetry')
    const { ctx, fiber, backend } = await boot({ root })
    expect(backend.sharing).toBe('local')
    expect(backend.root).toBe(root)
    expect(existsSync(root)).toBe(true)

    const alpha = ctx.sessions.create(SessionId('alpha'), { meta: { cwd: '/tmp/alpha' } })
    const beta = ctx.sessions.create(SessionId('beta'), { meta: {} })
    alpha.append('turn/start', { turn: 1 })
    alpha.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } })
    beta.append('turn/start', { turn: 1 })
    await fiber.dispose()

    expect(readdirSync(root).sort()).toEqual(['alpha.jsonl', 'beta.jsonl'])
    const alphaRecords = records(join(root, 'alpha.jsonl'))
    expect(alphaRecords.map(record => [record.channel, record.attributes['event.type'] ?? record.attributes['telemetry.op']])).toEqual([
      ['ledger', 'turn/start'],
      ['ledger', 'turn/end'],
      ['ops', 'shutdown'],
    ])
    expect(alphaRecords[1]?.severity).toBe('error')
    expect(alphaRecords[0]?.attributes).toMatchObject({ 'session.id': 'alpha', 'event.seq': 0, 'session.cwd': '/tmp/alpha' })
    expect(alphaRecords[0]?.body).toEqual({ turn: 1 })
    expect(records(join(root, 'beta.jsonl')).map(record => record.attributes['event.type'] ?? record.attributes['telemetry.op']))
      .toEqual(['turn/start', 'shutdown'])
  })

  it('resolves the default root under the harness home', async () => {
    const home = temp()
    vi.stubEnv('DSH_HOME', home)
    const { fiber, backend } = await boot()
    expect(backend.root).toBe(join(home, DEFAULT_ROOT_DIR_NAME))
    expect(existsSync(backend.root)).toBe(true)
    await fiber.dispose()
  })

  it('keeps file stems filesystem-safe and routes unscoped direct records to their own file', async () => {
    const root = join(temp(), 'telemetry')
    const { ctx, fiber } = await boot({ root })
    const session = ctx.sessions.create(SessionId('team/alpha:1'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    const direct: SessionTelemetryRecord = {
      channel: 'ledger',
      time: 1,
      severity: 'info',
      attributes: { 'event.type': 'manual', 'event.seq': 99 },
      body: { direct: true },
    }
    ctx.sessionTelemetry.emit(direct)
    await fiber.dispose()

    expect(readdirSync(root).sort()).toEqual(['team_alpha_1.jsonl', `${UNSCOPED_FILE_STEM}.jsonl`].sort())
    expect(records(join(root, `${UNSCOPED_FILE_STEM}.jsonl`))).toEqual([direct])
    const scoped = records(join(root, 'team_alpha_1.jsonl'))
    expect(scoped.map(record => record.attributes['event.type'] ?? record.attributes['telemetry.op'])).toEqual(['turn/start', 'shutdown'])
    expect(scoped.map(record => record.attributes['session.id'])).toEqual(['team/alpha:1', 'team/alpha:1'])
  })

  it('fails at plugin load when the root cannot become a directory', async () => {
    const file = join(temp(), 'occupied')
    writeFileSync(file, 'not a directory\n')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await expect(ctx.plugin(FileSessionTelemetryBackend, { root: file })).rejects.toThrow()
  })

  it('logs a failed stream, loses only its record, recovers on the next one, and skips a dead stream at disposal', async () => {
    const root = join(temp(), 'telemetry')
    const { ctx, fiber } = await boot({ root })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    rmSync(root, { recursive: true, force: true })

    const session = ctx.sessions.create(SessionId('lost'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    // A direct record for a stem no session owns: its stream fails too and
    // nothing ever writes to that stem again, so it is still dead at disposal.
    ctx.sessionTelemetry.emit({
      channel: 'ledger',
      time: 1,
      severity: 'info',
      attributes: { 'session.id': 'orphan', 'event.type': 'manual', 'event.seq': 1 },
      body: {},
    })
    await vi.waitFor(() => {
      expect(warn.mock.calls.filter(args => String(args[0]).includes('session-telemetry-file: writing'))).toHaveLength(2)
    })

    mkdirSync(root, { recursive: true })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await fiber.dispose()

    expect(readdirSync(root)).toEqual(['lost.jsonl'])
    expect(records(join(root, 'lost.jsonl')).map(record => record.attributes['event.type'] ?? record.attributes['telemetry.op']))
      .toEqual(['turn/end', 'shutdown'])
  })
})
