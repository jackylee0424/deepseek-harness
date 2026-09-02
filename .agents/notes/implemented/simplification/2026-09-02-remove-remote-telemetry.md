# Agent Note: Remove remote telemetry

Status: implemented

English | [中文](2026-09-02-remove-remote-telemetry.zh.md)

## Problem

The shipped `dsh-base` bundle mounted `dsh-session-telemetry-otel`, whose default `FEEDBACK_ONLY` mode uploaded unredacted session records (message text, tool arguments and results, workspace paths) to `https://harness-telemetry.deepseeksvc.com/v1/logs` whenever a user recorded `/feedback`, and whose `FULL` mode streamed every projected session event there. Independently, `dsh-llm-deepseek` attached the stable per-installation `x-deepseek-harness-user-id` header and the durable `x-deepseek-harness-session-id` header to every provider request, and the `plugin-package-inventory-deepseek` row added the active plugin package inventory to every request body by default. Each channel reported harness usage to a remote party without being required for the model request, and opting out meant knowing three separate switches: `DSH_TELEMETRY_DISABLED`, `DSH_TELEMETRY_MODE`, and the inventory row's `enabled` configuration. The repository owner asked for every outbound telemetry path to be removed or disabled while local capture stays available.

## Decision

Nothing leaves the process except the provider, web-search, and web-fetch requests a user's own work causes and any traffic a deployment configures explicitly.

- `@deepseek-ai/dsh-session-telemetry-otel` is deleted together with its `@opentelemetry/*` dependencies, its `dsh-base` row, the `DSH_TELEMETRY_MODE` and `DSH_TELEMETRY_OTLP_URL` configuration, and the launcher's `DSH_TELEMETRY_DISABLED` boot patch. The shipped backend is the local-file provider from [Local session telemetry files](../feature/2026-09-02-local-session-telemetry-files.md), so the `/feedback` acknowledgement reports `Session records are captured locally and never shared.`
- `@deepseek-ai/dsh-session-telemetry` stays as a local library: the Service Definition and capture coordinator transmit nothing by themselves and remain the extension point for a deployment that mounts its own backend.
- `@deepseek-ai/dsh-anonymous-user-id` stays and has one shipped consumer, the `/feedback` acknowledgement; `$DSH_HOME/.anonymous-user-id` is created only when feedback is recorded.
- `dsh-llm-deepseek` sends neither `x-deepseek-harness-user-id` nor `x-deepseek-harness-session-id`. The provider-neutral `User-Agent` attribution and the `x-deepseek-harness-compact` purpose flag are unchanged, and `GenerateOptions.sessionId` still reaches the request-extension contributors.
- The `plugin-package-inventory-deepseek` row ships `disabled: true` in `dsh-base` and `dsh-sdk-minimal`; a deployment overlay re-enables it. `session-log-deepseek` keeps its existing default-off `enabled` configuration.
- CI workflows, tests, fixtures, and release scripts no longer set `DSH_TELEMETRY_DISABLED`.

## Verification

`dsh-llm-deepseek` wire tests assert that direct and Loader-composed requests carry `User-Agent` and neither identity header, including when a session id is supplied. The `dsh-base` bundle test asserts that the OpenTelemetry row is absent, the local-file row is mounted, and the inventory row is disabled. The `/feedback` web golden pins the local-capture sentence. The module graph, config catalog, doc graphs, translation pairing, and package-invariant gates verify that no live composition, catalog, or document references the deleted package.

## Alternatives considered

**Keep the backend mounted with `DISABLED` as the default.** Rejected because the production endpoint would stay compiled into every profile, one environment variable would re-enable uploads, and the OpenTelemetry SDK and its transport would remain in every shipped profile's runtime closure for no default benefit.

**Delete the telemetry seam, the feedback command, and the anonymous id as well.** Rejected because none of them transmits anything: the seam is capture-only until a backend is mounted, the feedback event is log-only, and the id is shown to the user in the acknowledgement. Removing them would change the feedback experience and the session event vocabulary without reducing outbound traffic, and the owner wants local telemetry to remain possible.

**Keep `x-deepseek-harness-session-id` because it is per conversation rather than per installation.** Rejected because it exists only for provider-side correlation; the completion request does not need it, and it would still tie every request to a harness-generated durable identity.

**Remove the DeepSeek request-extension registry and both contributors.** Rejected because the registry sends nothing on its own, `session-log-deepseek` was already opt-in, and keyless replay plus both SDK snapshot suites pin the registry's acceptance transaction. Disabling the default-on inventory row removes the outbound field without a wire-protocol change.

## Consequences

No shipped profile contacts a telemetry collector, and DeepSeek receives only the product `User-Agent` and the completion request. Provider-side support loses cross-session correlation and the plugin inventory unless a deployment re-enables the inventory row or opts into `session-log-deepseek`. The `/feedback` command still records its event locally but can no longer release it to a collector. A deployment that wants remote export replaces the local-file row with its own `SessionTelemetryBackend` implementation; the seam's capture, projection, and redaction contracts are unchanged for it. The following decisions no longer stand and link here: [OTel revival](../feature/2026-07-23-session-telemetry-otel-revival.md), [anonymous user id on exports](../feature/2026-07-31-telemetry-anonymous-user-id.md), [base-bundle mount](../feature/2026-07-31-web-telemetry-default-mount.md), [feedback-gated mode](../feature/2026-08-05-feedback-gated-session-telemetry.md), [default off](../feature/2026-08-10-telemetry-default-off.md), [feedback-gated default](../feature/2026-08-25-feedback-gated-telemetry-default.md), [buffer-free feedback telemetry](2026-08-06-buffer-free-feedback-telemetry.md), and [DeepSeek request identity headers](../feature/2026-08-11-deepseek-request-user-id-header.md).
