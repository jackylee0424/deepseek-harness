# Agent Note: Shared anonymous user id across telemetry, feedback, and DeepSeek requests

Status: implemented

English | [中文](2026-08-07-shared-feedback-telemetry-user-id.zh.md)

## Problem

The OpenTelemetry backend already persisted one anonymous UUID in `$DSH_HOME/.anonymous-user-id`. `/feedback` now needs to report both the receiving session id and a user id so an operator can correlate the acknowledgement with exported records. Duplicating or independently generating that identity would make the reported user meaningless, while importing it from `session-telemetry-otel` would make a direct command depend on an exporter backend and create a dependency cycle when feedback export is mounted by telemetry.

The earlier [anonymous-user-id decision](../feature/2026-07-31-telemetry-anonymous-user-id.md) deliberately kept the helper inside the OTel backend until a second real consumer existed. Feedback became that second consumer. [Direct DeepSeek request identity](../feature/2026-08-11-deepseek-request-user-id-header.md) is the third.

## Decision

`@deepseek-ai/dsh-anonymous-user-id` owns `getOrCreateAnonymousUserId()` and the `$DSH_HOME/.anonymous-user-id` storage contract. The `/feedback` success acknowledgement reports `Feedback recorded for session {sessionId}` followed by `Anonymous user: {userId}` on a second line; it is the only shipped consumer since [Remove remote telemetry](../simplification/2026-09-02-remove-remote-telemetry.md) deleted the OpenTelemetry backend that carried the id as Resource `user.id` and the DeepSeek `x-deepseek-harness-user-id` header. Invalid feedback is rejected before resolving the id, so an empty command does not create `.anonymous-user-id`.

The extraction preserves the existing random UUID, home resolution, process memo, exclusive-create concurrency, corruption replacement, and best-effort write semantics.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Import the helper from `session-telemetry-otel` | Couples feedback to an optional exporter backend and forms a reverse dependency cycle once telemetry exports feedback |
| Duplicate the persistence helper in feedback | Two implementations of one file contract can drift and race with different validation or failure semantics |
| Generate a separate feedback user id | The acknowledgement could not correlate with the OTel Resource and would not satisfy the reporting purpose |

## Consequences

- One harness home has one anonymous id, reported by feedback acknowledgements and available to any backend a deployment mounts.
- The feedback package depends only on the identity capability, not the telemetry seam or OTel SDK.
- The package is a justified shared library with three consumers; its empty invariant companion explains why reading the private file is not a useful runtime relationship check.
- The original anonymous-user-id Note remains authoritative for storage and privacy semantics, while this Note supersedes only its OTel-local ownership decision.
