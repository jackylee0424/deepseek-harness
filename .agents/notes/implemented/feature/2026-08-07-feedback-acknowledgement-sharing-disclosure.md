# Agent Note: Feedback acknowledgement sharing disclosure

Status: implemented

English | [中文](2026-08-07-feedback-acknowledgement-sharing-disclosure.zh.md)

## Problem

The `/feedback` command records a log-only `feedback/record` event and acknowledges the user, but the acknowledgement carried no durable context about what happened to the session: deployments that mount session telemetry (`FULL`, `FEEDBACK_ONLY`, or `DISABLED`) had no way to tell the user whether their feedback and session left the process, and the receiving session id was not echoed. The command plugin could not read the sharing policy because the telemetry seam exposed capture only, and the OTel mode enum lived in the optional backend package.

## Decision

The telemetry seam (`@deepseek-ai/dsh-session-telemetry`) now owns a backend-independent sharing vocabulary: `SessionTelemetrySharingStatus` (`full` | `feedback-only` | `disabled`) plus a required abstract `sharing` member on the `SessionTelemetryBackend` service class — every backend must disclose its policy, so a consumer renders "not configured" only when no telemetry service is mounted. A backend maps its own mode onto that status in its constructor and discloses it; the deleted OpenTelemetry backend did so for `SessionTelemetryMode` (the [feedback-gated delivery decision](2026-08-05-feedback-gated-session-telemetry.md) owned the mode semantics), including in `DISABLED`. The `/feedback` handler reads the mounted service through the plugin context (`ctx.get('telemetry')`, never a declared injection, so the command loads and runs without telemetry) and appends one sharing sentence to the acknowledgement: `Feedback recorded for session {id}. <sentence>`. No service → `Session sharing is not configured.`; `disabled` → `Session sharing is disabled.`; `feedback-only` → `Session sharing is feedback-gated; recording feedback releases the session prefix for sharing.`; `full` → `Session sharing is enabled.`; `local` → `Session records are captured locally and never shared.`

The disclosure states the current sharing policy only; it never promises delivery or retention. Handoff is the backend's non-blocking enqueue and batching, retry, and loss policy stay the backend SDK's, and a later reconfiguration can change what was shared, so the sentences claim nothing about what reached a collector or about future retention. The disclosure adds no session event and never reaches the model surface; the web client renders it through the existing command row (`CommandNode` outcome text) with no client change.

## Alternatives considered

**A client-side status RPC and badge.** Rejected because the acknowledgement is host-produced and the web client already renders the command result text verbatim in the command row; a separate RPC would duplicate the status in a second surface and add a wire contract for a sentence.

**Declared `telemetry` injection in `command-feedback`.** Rejected because telemetry is optional: a declared injection fails plugin load when the service is absent, while the command must work without it. The plugin reads the service with `ctx.get('telemetry')` at handler time instead.

**OTel package owns the vocabulary.** Rejected because `command-feedback` must not depend on the optional OTel backend package. The seam owns `SessionTelemetrySharingStatus` so any backend can disclose a policy.

## Consequences

The acknowledgement is user-visible: it names the receiving session and reports the current sharing policy, honest about the fire-and-forget handoff. Package tests pin the sentence for each status and for the absent-service case; the assembled-browser e2e runs against the shipped local-file backend from [Local session telemetry files](2026-09-02-local-session-telemetry-files.md) and pins its sentence (`Session records are captured locally and never shared.`) as a golden. The seam member is required, so a mounted backend always discloses a policy and the "not configured" sentence truthfully means no telemetry service; the `/feedback` command keeps working with no telemetry mounted. A still-blank web session renders no command row, so feedback recorded before the first message gets no visible acknowledgement (documented under the package README's limitations).
