---
description: "The identity package group: the anonymous, per-harness-home id that the feedback acknowledgement reports."
kind: "package-group"
---

# identity/ — shared identity

English | [中文](README.zh.md)

## Summary

The identity group provides one anonymous id per harness home that the `/feedback` acknowledgement reports, so a user quoting feedback can name their installation without identifying themselves. Nothing sends the id anywhere; a deployment-mounted telemetry backend may attach it to its own records. There is nothing to configure: the id appears automatically the first time feedback is recorded and stays stable until its file is deleted. The group has one package; this page maps it, and the package README owns the details.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.md) | Gives every harness home one anonymous id that the feedback acknowledgement reports, so an installation can be named without identifying the user |

<a id="related-documentation"></a>
## Related documentation

- [Session telemetry subsystem](../../docs/subsystems/session-telemetry.md) — the capture seam a deployment-mounted backend may extend with the id.
- [Remote telemetry removal](../../.agents/notes/implemented/simplification/2026-09-02-remove-remote-telemetry.md) — why no shipped feature transmits the id.
- [dsh-command-feedback](../feedback/command-feedback/README.md) — the feedback command that names the anonymous installation in its acknowledgement.

<a id="dev-note"></a>
## Dev Note

None.
