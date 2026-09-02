/**
 * `/login` and `/logout` over the real command registry, credential store, and
 * authorization seam, driven through a scripted flow: listing, starting with
 * and without a method, answering select and text questions, the flow
 * withdrawing a question, timeouts, settlement outcomes, and sign-out.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import AuthorizationService, { type AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandLogin from '@deepseek-ai/dsh-command-login'
import { internals } from '@deepseek-ai/dsh-command-login'

const KEY = credentialKey('test', 'acme')

/** How the scripted flow behaves on its next run. */
interface Behavior {
  /** Wait this long before asking for the code, so a short progress wait times out. */
  delayBeforeCodeMs?: number
  /** Withdraw the code question shortly after asking it instead of waiting for an answer. */
  withdrawCode?: boolean
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly behavior: Behavior
  readonly runs: string[]
}

const temps: string[] = []
const contexts: Context[] = []
const originalOpenBrowser = internals.openBrowser

beforeEach(() => {
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('SSH_TTY', '')
  internals.openBrowser = vi.fn(async () => {})
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  internals.openBrowser = originalOpenBrowser
  vi.unstubAllEnvs()
})

function stubAgent(ctx: Context): Agent {
  const session = ctx.sessions.create(SessionId(`login-${Math.random().toString(36).slice(2)}`))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Reject as soon as the attempt is withdrawn, the way a well-behaved flow honours its signal. */
function untilWithdrawn<T>(session: AuthorizationSession, pending: Promise<T>): Promise<T> {
  return Promise.race([pending, new Promise<never>((_resolve, reject) => {
    session.signal.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
  })])
}

/**
 * A flow shaped like pi-ai's Codex login: pick a method, get a page to open,
 * then answer a code question that races a callback the flow may withdraw.
 */
function scriptedFlow(ctx: Context, behavior: Behavior, runs: string[]) {
  return {
    key: KEY,
    label: 'Acme Cloud',
    methods: [{ id: 'oauth', label: 'Sign in with Acme' }, { id: 'api-key', label: 'Paste a key' }] as const,
    async run(session: AuthorizationSession): Promise<void> {
      runs.push(session.method)
      const how = await untilWithdrawn(session, session.prompt({
        kind: 'select',
        message: 'Select a login method:',
        options: [{ id: 'browser', label: 'Browser login' }, { id: 'device_code', label: 'Device code login' }],
      }))
      session.notify({ message: 'Open this page to continue.', url: `https://acme.test/auth?via=${how}` })
      if (how === 'device_code') session.notify({ message: 'Enter this code on that page.', url: 'https://acme.test/device', code: 'ABCD-1234' })
      if (behavior.delayBeforeCodeMs !== undefined) await delay(behavior.delayBeforeCodeMs)
      const manual = new AbortController()
      session.signal.addEventListener('abort', () => { manual.abort() }, { once: true })
      const question = behavior.withdrawCode === true
        ? session.prompt({ kind: 'text', message: 'Paste the code:', signal: manual.signal })
        : session.prompt({ kind: 'text', message: 'Paste the code:', placeholder: 'code', signal: manual.signal })
      let code: string
      if (behavior.withdrawCode === true) {
        session.notify({ message: 'Callback received; finishing.' })
        await delay(10)
        manual.abort()
        await expect(question).rejects.toMatchObject({ code: 'WITHDRAWN' })
        code = 'callback'
      } else {
        code = await question
        manual.abort()
      }
      if (code === 'boom') throw new Error('exchange failed')
      await ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'api-key', key: `token-${how}-${code}` }))
    },
  }
}

async function harness(
  options: { authorization?: boolean; flow?: boolean; progressTimeoutMs?: number; openBrowser?: boolean } = {},
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-command-login-'))
  temps.push(dir)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  const behavior: Behavior = {}
  const runs: string[] = []
  if (options.authorization !== false) {
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(AuthorizationService)
    if (options.flow !== false) ctx.authorization.registerFlow(scriptedFlow(ctx, behavior, runs))
  }
  await ctx.plugin(commandLogin, {
    ...options.progressTimeoutMs === undefined ? {} : { progressTimeoutMs: options.progressTimeoutMs },
    ...options.openBrowser === undefined ? {} : { openBrowser: options.openBrowser },
  })
  const agent = stubAgent(ctx)
  ctx.agents.register(agent)
  return { ctx, agent, behavior, runs }
}

async function run(test: Harness, line: string): Promise<{ kind: string; text?: string }> {
  const settled = await test.ctx.commands.execute(test.agent, line, [], new AbortController().signal)
  if (settled === undefined) throw new Error(`${line} was not registered`)
  return settled.result
}

/** Execute one line and assert its outcome kind and a fragment of its text. */
async function expectResult(test: Harness, line: string, kind: 'success' | 'error', contains: string): Promise<void> {
  const result = await run(test, line)
  expect(result.kind).toBe(kind)
  expect(result.text).toContain(contains)
}

async function signedIn(test: Harness): Promise<boolean> {
  return (await test.ctx.credentials.describeRecord(KEY)).configured
}

describe('@deepseek-ai/dsh-command-login registration', () => {
  it('registers two global commands with Loader-safe exports and hides their input from the log', async () => {
    const test = await harness()
    expect(commandLogin.name).toBe('command-login')
    expect(commandLogin.inject).toEqual(['commands'])
    expect('default' in commandLogin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandLogin)).toBe(commandLogin)
    const names = test.ctx.commands.list(test.agent).map(command => command.name)
    expect(names).toContain('login')
    expect(names).toContain('logout')
    await run(test, '/login acme secret-word')
    const runEvents = test.agent.session.snapshotEvents().filter(event => event.type === 'command/run')
    expect(runEvents.some(event => JSON.stringify(event).includes('secret-word'))).toBe(false)
  })

  it('refuses a negative progress wait at load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(CommandRuntime)
    await expect(ctx.plugin(commandLogin, { progressTimeoutMs: -1 })).rejects.toThrow(/progressTimeoutMs/)
  })
})

describe('/login', () => {
  it('lists every sign-in with its stored-record state', async () => {
    const test = await harness()
    await expectResult(test, '/login', 'success', '- acme — Acme Cloud: not signed in')
    const empty = await harness({ flow: false })
    await expectResult(empty, '/login', 'success', 'No provider offers a sign-in')
  })

  it('walks the flow: method question, page notice, code question, then a stored credential', async () => {
    const test = await harness()
    const started = await run(test, '/login acme')
    expect(started.kind).toBe('success')
    expect(started.text).toContain('Acme Cloud (acme): signing in…')
    expect(started.text).toContain('- device_code — Device code login')
    expect(started.text).toContain('Choose with /login acme <option>')
    expect(test.runs).toEqual(['oauth'])

    const paged = await run(test, '/login acme Device code login')
    expect(paged.text).toContain('Open: https://acme.test/device')
    expect(paged.text).toContain('Code: ABCD-1234')
    expect(paged.text).toContain('Browser: opened automatically')
    expect(vi.mocked(internals.openBrowser).mock.calls.map(([url]) => url))
      .toEqual(['https://acme.test/auth?via=device_code', 'https://acme.test/device'])
    expect(paged.text).toContain('Paste the code:\nAnswer with /login acme <value> (for example code)')

    const status = await run(test, '/login acme')
    expect(status.text).toBe(paged.text)

    const done = await run(test, '/login acme 4242')
    expect(done.text).toContain('Acme Cloud (acme): signed in.')
    expect(await signedIn(test)).toBe(true)
    expect(await test.ctx.credentials.readRecord(KEY)).toEqual({ kind: 'api-key', key: 'token-device_code-4242' })
    await expectResult(test, '/login', 'success', 'acme — Acme Cloud: signed in')
  })

  it('starts with a named method and answers a select by option id', async () => {
    const test = await harness()
    await run(test, '/login acme Paste a key')
    expect(test.runs).toEqual(['api-key'])
    const paged = await run(test, '/login acme browser')
    expect(paged.text).toContain('via=browser')
  })

  it('rejects an unknown provider, an unknown method, an answer with no question, and an answer outside the options', async () => {
    const test = await harness({ progressTimeoutMs: 20 })
    await expectResult(test, '/login nope', 'error', 'No sign-in is registered for "nope"')
    await expectResult(test, '/login acme banana', 'error', 'methods: oauth — Sign in with Acme; api-key — Paste a key')
    await run(test, '/login acme')
    await expectResult(test, '/login acme telepathy', 'error', '"telepathy" is not one of the offered options')
    test.behavior.delayBeforeCodeMs = 200
    const paged = await run(test, '/login acme browser')
    expect(paged.text).not.toContain('Paste the code')
    await expectResult(test, '/login acme 1234', 'error', 'has no question pending')
    await delay(250)
    await run(test, '/login acme 1234')
    expect(await signedIn(test)).toBe(true)
  })

  it('reports an exchange error as failed', async () => {
    const test = await harness()
    await run(test, '/login acme')
    await run(test, '/login acme browser')
    await expectResult(test, '/login acme boom', 'success', 'sign-in failed: exchange failed')
    await expectResult(test, '/login', 'success', 'acme — Acme Cloud: not signed in')
    await expect(run(test, '/logout acme')).resolves.toEqual({ kind: 'success', text: 'Acme Cloud (acme) is not signed in.' })
    // A settled attempt does not block a fresh start with a named method.
    await run(test, '/login acme Paste a key')
    expect(test.runs).toEqual(['oauth', 'api-key'])
  })

  it('survives the flow withdrawing its question and reports an attempt another surface owns', async () => {
    const test = await harness()
    test.behavior.withdrawCode = true
    await run(test, '/login acme')
    const paged = await run(test, '/login acme browser')
    expect(paged.text).toContain('Paste the code')
    await expect.poll(async () => (await run(test, '/login acme')).text).toContain('signed in.')
    await expectResult(test, '/login acme', 'success', 'already signed in')

    const foreign = test.ctx.authorization.begin({
      key: KEY,
      interaction: { notify: () => {}, prompt: () => new Promise(() => {}) },
    })
    await expectResult(test, '/login', 'success', 'acme — Acme Cloud: signing in…')
    await expectResult(test, '/login acme', 'success', 'signing in through another surface')
    test.ctx.authorization.cancel(KEY)
    await expect(foreign).resolves.toEqual({ status: 'cancelled' })
  })
})

describe('browser handoff', () => {
  it('reports a failed handoff, with any failure shape, and keeps the URL in the row', async () => {
    const test = await harness({ openBrowser: true })
    internals.openBrowser = vi.fn(async () => { throw new Error('no desktop') })
    await run(test, '/login acme')
    const paged = await run(test, '/login acme browser')
    expect(paged.text).toContain('Open: https://acme.test/auth?via=browser')
    expect(paged.text).toContain('Browser: could not open (no desktop); open the page yourself')

    internals.openBrowser = vi.fn(async () => { throw 'desktop unavailable' })
    await run(test, '/login acme 1')
    await run(test, '/logout acme')
    await expectResult(test, '/login acme', 'success', 'signed in.')
    await run(test, '/login acme')
    await expectResult(test, '/login acme browser', 'success', 'could not open (desktop unavailable)')
  })

  it('answers before a slow handoff settles and reports it afterwards', async () => {
    const test = await harness({ progressTimeoutMs: 50 })
    let finish!: () => void
    internals.openBrowser = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    await run(test, '/login acme')
    const paged = await run(test, '/login acme browser')
    expect(paged.text).not.toContain('Browser:')
    finish()
    await expect.poll(async () => (await run(test, '/login acme')).text).toContain('Browser: opened automatically')
  })

  it('stays off when configured off or when the launch came over SSH', async () => {
    const off = await harness({ openBrowser: false })
    await run(off, '/login acme')
    await run(off, '/login acme browser')
    expect(internals.openBrowser).not.toHaveBeenCalled()

    vi.stubEnv('SSH_CONNECTION', '10.0.0.2 51234 10.0.0.9 22')
    const remote = await harness({ openBrowser: true })
    await run(remote, '/login acme')
    const paged = await run(remote, '/login acme browser')
    expect(paged.text).toContain('Open: https://acme.test/auth?via=browser')
    expect(internals.openBrowser).not.toHaveBeenCalled()
  })
})

describe('/logout', () => {
  it('needs a provider, knows the registered ones, and reports an absent sign-in', async () => {
    const test = await harness()
    const missing = await run(test, '/logout')
    expect(missing.kind).toBe('error')
    expect(missing.text).toContain('Name the provider')
    const unknown = await run(test, '/logout nope')
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('No sign-in is registered for "nope"')
    await expect(run(test, '/logout acme')).resolves.toEqual({ kind: 'success', text: 'Acme Cloud (acme) is not signed in.' })
  })

  it('withdraws a running attempt and deletes a stored record', async () => {
    const test = await harness()
    await run(test, '/login acme')
    await expect(run(test, '/logout acme')).resolves.toEqual({ kind: 'success', text: 'Signed out of Acme Cloud (acme).' })
    await expect.poll(async () => (await run(test, '/login acme')).text).toContain('sign-in cancelled.')

    await run(test, '/login acme')
    await run(test, '/login acme browser')
    await run(test, '/login acme 9999')
    await expect.poll(() => signedIn(test)).toBe(true)
    await expect(run(test, '/logout acme')).resolves.toEqual({ kind: 'success', text: 'Signed out of Acme Cloud (acme).' })
    expect(await signedIn(test)).toBe(false)
  })
})

describe('without an authorization service', () => {
  it('answers both commands with the same unavailable error', async () => {
    const test = await harness({ authorization: false })
    for (const line of ['/login', '/logout acme']) {
      const result = await run(test, line)
      expect(result.kind).toBe('error')
      expect(result.text).toContain('Sign-in is unavailable')
    }
  })
})
