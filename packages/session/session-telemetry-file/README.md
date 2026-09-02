---
description: "The shipped local-file session-telemetry backend for deployments choosing where per-session JSONL telemetry lands on this machine, mounting redaction, or reading the files."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-telemetry-file

English | [中文](README.zh.md)

## Summary

`dsh-session-telemetry-file` keeps session telemetry on this machine: it is the shipped backend for the [session-telemetry seam](../session-telemetry/README.md) and appends every captured record — each session-log event as the seam projects it, plus the `agent-error` and `shutdown` operational markers — as one JSON line to `<root>/<session id>.jsonl`. Nothing is transmitted anywhere, so the `/feedback` acknowledgement reports `Session records are captured locally and never shared.` Choose it when you want a flat, uncompressed, per-session record stream to inspect or feed into tooling you run yourself; the canonical session log under session persistence remains the source of truth. Records carry complete event data as the seam's redaction waterfall returns it, so a deployment that must keep secrets out of these files mounts its own rules there.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a composition that already mounts `dsh-session`; the shipped `dsh-base` bundle does so for every base-backed profile.

### When to choose it

Choose it when session activity should be readable as plain JSONL on the local disk — for debugging, auditing, or a collector you run yourself — without any network transport. Leave it out of a composition that must write nothing beyond the session store; the seam then has no backend and the `/feedback` acknowledgement reports `Session sharing is not configured.`

### Minimal configuration

```yaml
- id: session-telemetry-file
  name: '@deepseek-ai/dsh-session-telemetry-file'
  config:
    root: /var/lib/dsh/telemetry   # optional; defaults to $DSH_HOME/telemetry
```

| Field | Default | Meaning |
|---|---|---|
| `root` | `telemetry` under the resolved harness home (`$DSH_HOME`, else `~/.dsh`) | Directory receiving one `<session id>.jsonl` file per session; created at plugin load |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-telemetry-file) is the exhaustive source for every accepted field.

### On-disk layout

Each session id becomes one file stem, with every character outside `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-` replaced by `_`; a record handed over without a `session.id` attribute lands in `unscoped.jsonl`. Every line is one seam record: `channel`, `time`, `severity`, `attributes` (`session.id`, `event.type`, `event.seq`, and the session header facts the seam adds), and the complete event data as `body`. Only the first `assistant/chunk` of each step is recorded, so `event.seq` gaps are routine. A session's `shutdown` marker ends its file; a later record for the same session id appends to the same file through a fresh stream.

### Durability and failures

Lines go through one append stream per session, so a record accepted by `emit()` reaches the file once Node flushes the stream; plugin disposal ends every stream and waits for each to close, which is how the shutdown markers reach disk before process exit. A `root` that cannot become a directory fails at plugin load. A stream failure at run time (a deleted directory, a full disk) is logged as a warning, that record is lost, and the next record for the session opens a fresh stream.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the backend's composition; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The backend is a thin sink under the seam's coordinator: capture, projection, redaction, and the handoff cursor live in `dsh-session-telemetry`, and this package owns only the file layout and the stream lifecycle. It composes the coordinator in `live` mode, so records follow session events as they are appended, and lifecycle markers are captured at session disposal and plugin teardown.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: root resolution, per-session append streams, shutdown-marker close, disposal drain |

### Stream lifecycle

One `fs.WriteStream` per file stem opens on the first record and stays open until the session's `shutdown` marker or plugin disposal. A failed stream is left destroyed and replaced on the next record, so one bad write never blocks later sessions. `flush()` is deliberately unimplemented: the stream writes through, and disposal owns the only drain.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the backend contract is not enough. They move from the seam it implements to the subsystem reference and the decision evidence.

- [Session telemetry seam](../session-telemetry/README.md) — the capture contract, record vocabulary, and redaction waterfall.
- [Session telemetry subsystem](../../../docs/subsystems/session-telemetry.md) — the capability split and type declarations.
- [Session persistence (JSONL)](../session-persistence-jsonl/README.md) — the canonical session log these files project.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-telemetry-file) — every accepted config field and its source declaration.
- [Local session telemetry files decision](../../../.agents/notes/implemented/feature/2026-09-02-local-session-telemetry-files.md) — rationale and rejected alternatives.

-----

<a id="model-experience"></a>
## Model Experience

None, as the backend appends seam records to local files and registers nothing model-facing.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe what the local files do and do not guarantee. They are current package constraints.

- **Best-effort delivery** — a record whose stream fails is lost with a warning while the seam's cursor still marks it handed off; there is no retry or spool.
- **Unbounded growth** — files are never rotated, compressed, or pruned; a deployment owns retention under `root`.
- **No built-in redaction** — with no `session-telemetry/record` listener mounted, files carry message text, tool arguments and results, and the session `cwd` exactly as captured.
- **Stem collisions** — two session ids that differ only in characters outside the safe set share one file.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package's whole output is an append to a local file outside every authoritative event stream, so no event/data relation exists for an independent companion to observe.
