# Agent Note: Local session telemetry files

Status: implemented

English | [中文](2026-09-02-local-session-telemetry-files.zh.md)

## Problem

[Remove remote telemetry](../simplification/2026-09-02-remove-remote-telemetry.md) deleted the only `SessionTelemetryBackend` implementation, leaving `dsh-session-telemetry` as a capture seam that no shipped composition exercised: records were projected for nobody, `/feedback` reported that sharing was not configured, and the repository owner still wanted session telemetry available on the machine for inspection and for tooling of their own. The canonical session log already persists every event, but it is organized per project, optionally compressed, and carries neither severity nor operational markers, so it is not a drop-in replacement for a flat telemetry stream.

## Decision

`@deepseek-ai/dsh-session-telemetry-file` is the shipped Service Provider for the session-telemetry seam, and `dsh-base` mounts it as the `session-telemetry-file` row.

- The backend composes `SessionTelemetryCoordinator` in `live` capture and appends every record — each projected session event plus the `agent-error` and `shutdown` operational markers — as one JSON line to `<root>/<session id>.jsonl`, where `root` defaults to `telemetry` under the resolved harness home and is the plugin's only configuration. Session ids map onto filesystem-safe stems; a record without a `session.id` attribute lands in `unscoped.jsonl`.
- One append stream per session opens lazily and closes at the session's `shutdown` marker; plugin disposal ends every open stream and resolves only after each has closed, so the markers reach disk before the process exits. A root that cannot become a directory fails at plugin load; a run-time stream failure is logged, drops that record, and the next record for the session opens a fresh stream.
- The seam's `SessionTelemetrySharingStatus` gains `local`, which the backend discloses and `/feedback` renders as `Session records are captured locally and never shared.`
- `dsh-sdk-minimal` stays without telemetry, matching its documented exclusion list.

## Verification

The package unit tier drives the real coordinator through a session store and pins per-session files, shutdown-marker order, severity mapping, default-root resolution, stem sanitization, the unscoped file, load-time failure on a non-directory root, and recovery after a stream error; a real-Loader composition mounts the row from `cordis.yml`. The `dsh-base` bundle test asserts the row, the feedback command's unit tests pin the `local` sentence, and the `/feedback` web golden pins it through the shipped bundles.

## Alternatives considered

**Rely on the persisted session log alone.** Rejected because the owner asked for telemetry capture, not only persistence: the JSONL session store is organized per project, may be Zstandard-compressed, and lacks the seam's severity and operational markers, and the seam would otherwise remain dead code.

**Write one file per process instead of per session.** Rejected because a per-session file bounds growth to the session, is deleted with it, and needs no filtering to read one conversation; the process-level file would have been simpler to implement but harder to use.

**Reuse `disabled` or `full` as the disclosed status.** Rejected because `full` reads as sharing and `disabled` as capturing nothing; the acknowledgement must state that records are captured and stay local, which needs its own vocabulary entry.

**Buffer records and write on a timer.** Rejected because Node's append stream already batches writes off the hot path, and a timer would add a loss window without measurable benefit.

## Consequences

Every base-backed profile writes session telemetry to `$DSH_HOME/telemetry/` by default; the files grow without rotation and carry message text, tool arguments and results, and the session `cwd` exactly as captured, so a deployment that needs redaction mounts `session-telemetry/record` rules and one that wants no files patches the row `disabled: true`. Nothing is transmitted, and the `/feedback` acknowledgement says so. A deployment that wants a collector replaces the row with its own backend; the seam contract is unchanged.
