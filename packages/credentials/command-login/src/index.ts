/**
 * `/login` and `/logout`: the conversation surface of the authorization seam.
 * `/login` lists every registered sign-in flow with its stored-record status;
 * `/login <provider> [method]` starts that flow's attempt and returns its first
 * instruction; while an attempt runs, `/login <provider> <answer>` answers the
 * flow's pending question (a login method, a pasted code) and a bare
 * `/login <provider>` reports the latest notice. `/logout <provider>` withdraws
 * a running attempt and deletes the stored record. An attempt keeps running
 * after its command returns, so the transcript row carries the page or code
 * the human must act on and a later invocation reports the outcome. A page a
 * flow names is also opened in this host's default browser unless the launch
 * came over SSH. Neither command records its input in the session log,
 * because an answer can be a one-time code or a key.
 * @module @deepseek-ai/dsh-command-login
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationDeclinedError,
  AuthorizationError,
  type AuthorizationEntry,
  type AuthorizationNotice,
  type AuthorizationPrompt,
  type AuthorizationService,
  type AuthorizationSettlement,
} from '@deepseek-ai/dsh-authorization'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { credentialKeyId, type CredentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { launchedThroughSsh, openBrowser } from '@deepseek-ai/dsh-host-browser-open'

export const name = 'command-login'
export const inject = ['commands']

/** Plugin configuration. */
export interface Config {
  /**
   * How long one `/login` invocation waits for the flow's next notice or
   * question before it answers with whatever it has; the attempt keeps running
   * afterwards and a later `/login <provider>` reports it. Defaults to
   * {@link DEFAULT_PROGRESS_TIMEOUT_MS}.
   */
  progressTimeoutMs?: number
  /**
   * Open a page a flow names in this host's default browser. Defaults to
   * `true`; a launch over SSH suppresses it regardless, because the operator's
   * browser is elsewhere. The acknowledgement carries the URL either way.
   */
  openBrowser?: boolean
}

/** Schemastery validator for {@link Config}; cordis runs it before the plugin starts. */
export const Config: z<Config> = z.object({
  progressTimeoutMs: z.number(),
  openBrowser: z.boolean(),
})

/** Wait applied when the configuration names no `progressTimeoutMs`. */
export const DEFAULT_PROGRESS_TIMEOUT_MS = 5_000

/** Test hook for the native browser handoff; production never mutates it. */
export const internals: { openBrowser: (url: string) => Promise<void> } = { openBrowser }

const USAGE = 'Usage: /login — list sign-ins; /login <provider> [method] — start one; /login <provider> <answer> — answer its question; /logout <provider>'

/** Resolve the configured wait, rejecting values a timer cannot honour. */
function resolveProgressTimeout(config: Config): number {
  const value = config.progressTimeoutMs ?? DEFAULT_PROGRESS_TIMEOUT_MS
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`command-login: progressTimeoutMs must be a non-negative finite number, got ${String(value)}`)
  }
  return value
}

/** Resolve whether pages a flow names are handed to this host's browser. */
function resolveOpenBrowser(config: Config): boolean {
  return config.openBrowser ?? true
}

/** One line for a failure of any origin. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A question the flow asked that no invocation has answered yet. */
interface PendingQuestion {
  readonly prompt: AuthorizationPrompt
  readonly resolve: (answer: string) => void
  readonly reject: (error: Error) => void
}

/** One attempt this plugin started, kept after settlement so the outcome can be reported. */
interface Attempt {
  readonly key: CredentialKey
  readonly notices: AuthorizationNotice[]
  pending: PendingQuestion | undefined
  settlement: AuthorizationSettlement | 'running'
  /** The failure message once `settlement` is `failed`; empty otherwise. */
  failure: string
  /** Bumped on every notice, question, answer, settlement, or browser outcome; waiters compare against it. */
  version: number
  readonly waiters: Set<() => void>
  /** Outcome of handing the latest page to the browser, once known. */
  browser: string | undefined
  /** The handoff still in flight, so an invocation can wait for its outcome. */
  opening: Promise<void> | undefined
}

/** The two services every invocation needs; absent in a composition without sign-ins. */
interface Services {
  readonly authorization: AuthorizationService
  readonly credentials: CredentialProvider
}

function servicesOf(ctx: Context): Services | undefined {
  const authorization = ctx.get('authorization')
  const credentials = ctx.get('credentials')
  if (authorization === undefined || credentials === undefined) return undefined
  return { authorization, credentials }
}

const UNAVAILABLE: CommandResult = {
  kind: 'error',
  text: 'Sign-in is unavailable: this composition mounts no authorization or credential service.',
}

/** Record progress on an attempt and release every invocation waiting for it. */
function wake(attempt: Attempt): void {
  attempt.version += 1
  for (const waiter of [...attempt.waiters]) waiter()
}

/**
 * Resolve once the attempt moves past `since`, or after `timeoutMs`. A change
 * that already happened resolves immediately, which covers a flow that asks
 * its first question before the caller gets to wait.
 */
function waitForProgress(attempt: Attempt, since: number, timeoutMs: number): Promise<void> {
  if (attempt.version !== since) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      attempt.waiters.delete(done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    timer.unref()
    attempt.waiters.add(done)
  })
}

/** Park a flow's question until an invocation answers it or the flow withdraws it. */
function ask(attempt: Attempt, prompt: AuthorizationPrompt): Promise<string> {
  return new Promise((resolve, reject) => {
    const pending: PendingQuestion = {
      prompt,
      resolve: (answer) => {
        attempt.pending = undefined
        resolve(answer)
      },
      reject: (error) => {
        attempt.pending = undefined
        reject(error)
      },
    }
    attempt.pending = pending
    // The flow retiring its question (the losing side of a callback race):
    // not a decline, so the rejection carries a code of its own.
    prompt.signal?.addEventListener('abort', () => {
      if (attempt.pending === pending) pending.reject(new AuthorizationError('the flow withdrew its question', 'WITHDRAWN'))
    }, { once: true })
    wake(attempt)
  })
}

/** Hand one page to this host's browser and record the outcome for the status text. */
function handOff(attempt: Attempt, url: string): Promise<void> {
  return internals.openBrowser(url).then(
    () => { attempt.browser = 'opened automatically' },
    (error: unknown) => { attempt.browser = `could not open (${reasonOf(error)}); open the page yourself` },
  ).then(() => {
    attempt.opening = undefined
    wake(attempt)
  })
}

/** Wait for an in-flight browser handoff, but never longer than the progress wait. */
function settleHandoff(attempt: Attempt, timeoutMs: number): Promise<void> {
  const opening = attempt.opening
  if (opening === undefined) return Promise.resolve()
  return Promise.race([opening, new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    timer.unref()
  })])
}

/** Start one attempt and track it; the returned attempt keeps updating after this returns. */
function startAttempt(
  authorization: AuthorizationService,
  attempts: Map<CredentialKey, Attempt>,
  key: CredentialKey,
  method: string | undefined,
  handoff: boolean,
): Attempt {
  const attempt: Attempt = {
    key,
    notices: [],
    pending: undefined,
    settlement: 'running',
    failure: '',
    version: 0,
    waiters: new Set(),
    browser: undefined,
    opening: undefined,
  }
  attempts.set(key, attempt)
  const settle = (settlement: AuthorizationSettlement, failure: string): void => {
    attempt.settlement = settlement
    attempt.failure = failure
    // A question left open by a finished flow has nobody awaiting it.
    attempt.pending = undefined
    wake(attempt)
  }
  authorization.begin({
    key,
    ...method === undefined ? {} : { method },
    interaction: {
      notify: (notice) => {
        attempt.notices.push(notice)
        if (handoff && notice.url !== undefined) attempt.opening = handOff(attempt, notice.url)
        wake(attempt)
      },
      prompt: prompt => ask(attempt, prompt),
    },
  }).then(
    (outcome) => { settle(outcome.status, '') },
    (error: unknown) => { settle('failed', reasonOf(error)) },
  )
  return attempt
}

/** Match a typed answer against a `select` prompt's options by id or label; other prompts take the text verbatim. */
function resolveAnswer(prompt: AuthorizationPrompt, answer: string): string | undefined {
  if (prompt.kind !== 'select') return answer
  const wanted = answer.toLowerCase()
  return prompt.options.find(option => option.id === answer || option.label.toLowerCase() === wanted)?.id
}

/** Match a typed method against a flow's offered methods by id or label. */
function resolveMethod(entry: AuthorizationEntry, typed: string): string | undefined {
  const wanted = typed.toLowerCase()
  return entry.methods.find(method => method.id === typed || method.label.toLowerCase() === wanted)?.id
}

function labelOf(entry: AuthorizationEntry): string {
  return `${entry.label} (${credentialKeyId(entry.key)})`
}

function questionText(entry: AuthorizationEntry, prompt: AuthorizationPrompt): string {
  const id = credentialKeyId(entry.key)
  if (prompt.kind === 'select') {
    return [
      prompt.message,
      ...prompt.options.map(option => `- ${option.id} — ${option.label}`),
      `Choose with /login ${id} <option>`,
    ].join('\n')
  }
  const hint = prompt.placeholder === undefined ? '' : ` (for example ${prompt.placeholder})`
  return `${prompt.message}\nAnswer with /login ${id} <value>${hint}`
}

function settlementSentence(attempt: Attempt): string {
  switch (attempt.settlement) {
    case 'running': return 'signing in…'
    case 'authorized': return 'signed in.'
    case 'cancelled': return 'sign-in cancelled.'
    case 'failed': return `sign-in failed: ${attempt.failure}`
    /* v8 ignore next 2 -- the settlement union is closed; a new member must be given a sentence here. */
    default: return assertNever(attempt.settlement)
  }
}

/* v8 ignore next 3 -- only the ignored default arm calls this; the closed union cannot reach it via the public API. */
function assertNever(value: never): never {
  throw new Error(`command-login: unsupported settlement ${JSON.stringify(value)}`)
}

/** The transcript text for one attempt: outcome, latest instruction, pending question. */
function statusText(entry: AuthorizationEntry, attempt: Attempt): string {
  const lines = [`${labelOf(entry)}: ${settlementSentence(attempt)}`]
  const notice = attempt.notices.at(-1)
  if (notice !== undefined) {
    lines.push(notice.message)
    if (notice.url !== undefined) lines.push(`Open: ${notice.url}`)
    if (notice.code !== undefined) lines.push(`Code: ${notice.code}`)
  }
  if (attempt.browser !== undefined) lines.push(`Browser: ${attempt.browser}`)
  if (attempt.pending !== undefined) lines.push(questionText(entry, attempt.pending.prompt))
  return lines.join('\n')
}

/** One line per registered flow, with its stored-record or in-flight state. */
async function listText(
  entries: readonly AuthorizationEntry[],
  credentials: CredentialProvider,
  attempts: Map<CredentialKey, Attempt>,
): Promise<string> {
  if (entries.length === 0) return `No provider offers a sign-in in this composition.\n${USAGE}`
  const rows = await Promise.all(entries.map(async (entry) => {
    const running = entry.inFlight || attempts.get(entry.key)?.settlement === 'running'
    const state = running
      ? 'signing in…'
      : (await credentials.describeRecord(entry.key)).configured ? 'signed in' : 'not signed in'
    return `- ${credentialKeyId(entry.key)} — ${entry.label}: ${state}`
  }))
  return ['Provider sign-ins:', ...rows, USAGE].join('\n')
}

function findEntry(entries: readonly AuthorizationEntry[], target: string): AuthorizationEntry | undefined {
  return entries.find(entry => credentialKeyId(entry.key) === target || String(entry.key) === target)
}

async function login(
  ctx: Context,
  attempts: Map<CredentialKey, Attempt>,
  timeoutMs: number,
  handoff: boolean,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const services = servicesOf(ctx)
  if (services === undefined) return UNAVAILABLE
  const { authorization, credentials } = services
  const [target, ...rest] = invocation.rawInput.trim().split(/\s+/u).filter(word => word.length > 0)
  const entries = authorization.list()
  if (target === undefined) return { kind: 'success', text: await listText(entries, credentials, attempts) }
  const entry = findEntry(entries, target)
  if (entry === undefined) {
    return { kind: 'error', text: `No sign-in is registered for "${target}".\n${await listText(entries, credentials, attempts)}` }
  }
  const answer = rest.join(' ')
  const running = attempts.get(entry.key)
  if (running?.settlement === 'running') {
    if (answer.length === 0) return { kind: 'success', text: statusText(entry, running) }
    const pending = running.pending
    if (pending === undefined) {
      return { kind: 'error', text: `${labelOf(entry)} is signing in and has no question pending; run /login ${credentialKeyId(entry.key)} to see its progress.` }
    }
    const resolved = resolveAnswer(pending.prompt, answer)
    if (resolved === undefined) {
      return { kind: 'error', text: `"${answer}" is not one of the offered options.\n${questionText(entry, pending.prompt)}` }
    }
    const since = running.version
    pending.resolve(resolved)
    await waitForProgress(running, since, timeoutMs)
    await settleHandoff(running, timeoutMs)
    return { kind: 'success', text: statusText(entry, running) }
  }
  if (entry.inFlight) {
    return { kind: 'success', text: `${labelOf(entry)}: signing in through another surface; run /logout ${credentialKeyId(entry.key)} to withdraw it.` }
  }
  // A settled attempt is reported once, by the next bare invocation; anything
  // after that starts afresh.
  if (running !== undefined) {
    attempts.delete(entry.key)
    if (answer.length === 0) return { kind: 'success', text: statusText(entry, running) }
  }
  if ((await credentials.describeRecord(entry.key)).configured) {
    return { kind: 'success', text: `${labelOf(entry)}: already signed in. Run /logout ${credentialKeyId(entry.key)} first to sign in again.` }
  }
  let method: string | undefined
  if (answer.length > 0) {
    method = resolveMethod(entry, answer)
    if (method === undefined) {
      const methods = entry.methods.map(candidate => `${candidate.id} — ${candidate.label}`).join('; ')
      return { kind: 'error', text: `${labelOf(entry)} is not signing in, so "${answer}" answers nothing. Start with /login ${credentialKeyId(entry.key)} [method]; methods: ${methods}` }
    }
  }
  const attempt = startAttempt(authorization, attempts, entry.key, method, handoff)
  await waitForProgress(attempt, 0, timeoutMs)
  await settleHandoff(attempt, timeoutMs)
  return { kind: 'success', text: statusText(entry, attempt) }
}

async function logout(
  ctx: Context,
  attempts: Map<CredentialKey, Attempt>,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const services = servicesOf(ctx)
  if (services === undefined) return UNAVAILABLE
  const { authorization, credentials } = services
  const target = invocation.rawInput.trim()
  if (target.length === 0) return { kind: 'error', text: `Name the provider to sign out of. ${USAGE}` }
  const entry = findEntry(authorization.list(), target)
  if (entry === undefined) return { kind: 'error', text: `No sign-in is registered for "${target}". ${USAGE}` }
  const attempt = attempts.get(entry.key)
  const running = entry.inFlight || attempt?.settlement === 'running'
  if (running) {
    // A flow waiting on a question is unblocked with a decline — the human's
    // "no" — before the seam withdraws the attempt, so it settles as cancelled.
    attempt?.pending?.reject(new AuthorizationDeclinedError('signed out while the flow was waiting for an answer'))
    authorization.cancel(entry.key)
  }
  const stored = (await credentials.describeRecord(entry.key)).configured
  if (stored) await credentials.deleteRecord(entry.key)
  if (!running && !stored) return { kind: 'success', text: `${labelOf(entry)} is not signed in.` }
  return { kind: 'success', text: `Signed out of ${labelOf(entry)}.` }
}

/**
 * Register the global `/login` and `/logout` commands for every composed command adapter.
 * @param ctx - plugin context; `commands` is injected, the authorization and credential services are read per invocation.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const timeoutMs = resolveProgressTimeout(config)
  // The page belongs to this host; under SSH the operator's browser is on
  // another machine, so only the URL is reported there.
  const handoff = resolveOpenBrowser(config) && !launchedThroughSsh(ctx)
  const attempts = new Map<CredentialKey, Attempt>()
  ctx.commands.register({
    name: 'login',
    description: 'sign in to a provider account',
    input: { hint: '[provider] [method or answer]' },
    recordInput: false,
    handler: invocation => login(ctx, attempts, timeoutMs, handoff, invocation),
  })
  ctx.commands.register({
    name: 'logout',
    description: 'sign out of a provider account',
    input: { hint: '<provider>' },
    recordInput: false,
    handler: invocation => logout(ctx, attempts, invocation),
  })
}
