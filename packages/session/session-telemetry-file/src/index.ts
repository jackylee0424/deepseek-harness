/**
 * Local-file Service Provider for the DeepSeek Harness session-telemetry
 * capability. It composes the seam's capture coordinator in `live` mode and
 * appends every handed-over record as one JSON line to a per-session file
 * under a directory on this machine. Nothing leaves the process: the backend
 * discloses the `local` sharing status, and a deployment that wants
 * redaction before records reach disk mounts rules on the seam's
 * `session-telemetry/record` waterfall.
 *
 * @module @deepseek-ai/dsh-session-telemetry-file
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  SessionTelemetryBackend,
  SessionTelemetryCoordinator,
  type SessionTelemetryRecord,
  type SessionTelemetrySharingStatus,
} from '@deepseek-ai/dsh-session-telemetry'

/** Plugin configuration: where the per-session JSONL files live. */
export interface Config {
  /**
   * Directory receiving one `<session id>.jsonl` file per session, created at
   * plugin load when absent. Defaults to `telemetry` under the resolved
   * harness home (`$DSH_HOME`, else `~/.dsh`).
   */
  root?: string
}

/** Schemastery validator for {@link Config}; cordis runs it before the plugin starts. */
export const Config: z<Config> = z.object({
  root: z.string(),
})

/** Directory name under the harness home that receives the files when no `root` is configured. */
export const DEFAULT_ROOT_DIR_NAME = 'telemetry'

/** File stem receiving records handed over without a `session.id` attribute. */
export const UNSCOPED_FILE_STEM = 'unscoped'

/** Every character of a session id outside this set becomes `_` in its file stem. */
const UNSAFE_STEM_CHARACTERS = /[^A-Za-z0-9._-]/g

/** Map one record onto the stem of the file that receives it. */
function fileStem(record: SessionTelemetryRecord): string {
  const id = record.attributes['session.id']
  return id === undefined ? UNSCOPED_FILE_STEM : String(id).replace(UNSAFE_STEM_CHARACTERS, '_')
}

/**
 * The backend plugin — the one entry a deployment loads. It registers the
 * `sessionTelemetry` service, composes the seam's coordinator in `live`
 * capture, and appends each record as one JSON line to
 * `<root>/<session id>.jsonl` through a lazily opened append stream per
 * session. A session's `shutdown` marker closes its stream; disposal closes
 * every stream still open after the coordinator's final markers and resolves
 * once each has closed.
 */
export class FileSessionTelemetryBackend extends SessionTelemetryBackend {
  static inject = ['sessions']
  static Config = Config

  override readonly sharing: SessionTelemetrySharingStatus = 'local'
  /** Absolute directory holding the per-session files. */
  readonly root: string
  private readonly streams = new Map<string, WriteStream>()
  /** Streams ended but not yet closed; disposal waits for all of them. */
  private readonly closing = new Set<Promise<void>>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.root = config.root === undefined ? dshHomePath(DEFAULT_ROOT_DIR_NAME) : resolve(config.root)
    // Misconfiguration fails at load: a root that cannot become a directory rejects here.
    mkdirSync(this.root, { recursive: true })
    new SessionTelemetryCoordinator(ctx, this, 'live')
  }

  /**
   * Append one record as a JSON line to its session's file. Non-blocking:
   * the line enters the stream's buffer and Node writes it asynchronously.
   * A stream that failed earlier is replaced by a fresh one for this record.
   * @param record - the logical record to persist; JSON-serializable by the seam's contract.
   */
  emit(record: SessionTelemetryRecord): void {
    const stem = fileStem(record)
    const current = this.streams.get(stem)
    const stream = current !== undefined && !current.destroyed ? current : this.open(stem)
    stream.write(`${JSON.stringify(record)}\n`)
    if (record.channel === 'ops' && record.attributes['telemetry.op'] === 'shutdown') {
      this.streams.delete(stem)
      this.close(stream)
    }
  }

  /** Open the append stream for one file stem; a failure it reports later is logged, never thrown. */
  private open(stem: string): WriteStream {
    const path = join(this.root, `${stem}.jsonl`)
    const stream = createWriteStream(path, { flags: 'a' })
    stream.on('error', (error) => {
      this.ctx.logger.warn(`session-telemetry-file: writing ${path} failed: ${String(error)}`)
    })
    this.streams.set(stem, stream)
    return stream
  }

  /** End one stream and remember its close so {@link shutdown} can wait for it. */
  private close(stream: WriteStream): void {
    const closed = new Promise<void>((done) => {
      stream.once('close', () => {
        this.closing.delete(closed)
        done()
      })
      stream.end()
    })
    this.closing.add(closed)
  }

  /**
   * End every open stream and resolve once each ended stream has closed, so
   * every record accepted before this call is on disk before the process
   * exits. A stream that already failed is destroyed and skipped.
   * @returns resolves when all per-session streams are closed.
   */
  async shutdown(): Promise<void> {
    for (const stream of this.streams.values()) {
      if (!stream.destroyed) this.close(stream)
    }
    this.streams.clear()
    await Promise.all(this.closing)
  }
}

export default FileSessionTelemetryBackend
