/**
 * Real Loader composition: the backend mounted from `cordis.yml` beside the
 * session store, with its `root` validated by the runtime config schema,
 * writes a session's records and shutdown marker to the configured file.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'
import * as FileBackend from '@deepseek-ai/dsh-session-telemetry-file'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('local-file telemetry through a real Loader composition', () => {
  it('boots cordis.yml and writes the session file under the configured root', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-telemetry-file-loader-'))
    const telemetryRoot = join(root, 'telemetry')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-telemetry-file'",
      '  config:',
      `    root: ${JSON.stringify(telemetryRoot)}`,
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-telemetry-file', FileBackend],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(context.sessionTelemetry.sharing).toBe('local')
    const session = context.sessions.create(SessionId('composed'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    await context.fiber.dispose()
    context = undefined

    const lines = (await readFile(join(telemetryRoot, 'composed.jsonl'), 'utf8'))
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as SessionTelemetryRecord)
    expect(lines.map(record => record.attributes['event.type'] ?? record.attributes['telemetry.op'])).toEqual(['turn/start', 'shutdown'])
  })
})
