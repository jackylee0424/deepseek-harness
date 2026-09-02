---
description: "Default-browser handoff library for host surfaces that need to open a page on the operator's machine, such as the Web app's startup URL and a provider sign-in page, without leaking Harness credentials to the launcher."
kind: "package-library"
---

# @deepseek-ai/dsh-host-browser-open

English | [中文](README.zh.md)

## Summary

`dsh-host-browser-open` opens one URL in the operating system's default browser and tells a caller whether this process was launched over SSH, where the operator's browser is on another machine. The Web app uses it to open its tokenized startup URL, and the `/login` command uses it to open a provider's sign-in page. The launcher runs in a helper process whose environment is scrubbed of Harness credentials, so a browser integration never sees an API key; a failure to open reaches the caller as an error naming the helper's reason, and the caller decides how to fall back to a printed URL.

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

### When to use it

Reach for it from a host-side plugin that has a page the operator must see: a served UI, an authorization page, a report. Guard the call with `launchedThroughSsh(ctx)` so a remote launch prints the URL instead of opening a browser on the server; a browser-side package never needs it.

### Entry point

```text
import { launchedThroughSsh, openBrowser } from '@deepseek-ai/dsh-host-browser-open'

if (!launchedThroughSsh(ctx)) {
  await openBrowser(url) // resolves once the platform opener has the URL; rejects with the helper's reason
}
```

`openBrowser` resolves after the helper hands the URL to the platform opener, which on Windows means waiting for the operating-system launcher to accept it. It rejects with the helper's first stderr line, or its exit code when it printed nothing, and never throws synchronously. `launchedThroughSsh` reads `SSH_CONNECTION` and `SSH_TTY` from the process layer of the launch environment only, so a stale value in a project `.env` does not count. The exact contracts live in [`src/index.ts`](src/index.ts).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The helper is a one-line Node program that imports the maintained `open` package and forwards `process.argv[1]`; it runs under `scrubbedParentEnv()` from the subprocess package, so credential-shaped and `DSH_*` variables never reach the browser integration. The parent collects the helper's stderr, forwards it on a zero exit, and turns a non-zero exit or spawn error into the rejection reason.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `launchedThroughSsh`, the helper program, `openBrowser` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web app bundle](../../bundle/web-app/README.md) — the startup handoff that opens the tokenized GUI URL.
- [Login commands](../../credentials/command-login/README.md) — the sign-in surface that opens a provider's page.
- [Subprocess seam](../../subprocess/subprocess/README.md) — owns the credential-scrubbed environment the helper runs under.
- [Launch environment](../../util/launch-environment/README.md) — the layered snapshot the SSH guard reads.

-----

<a id="model-experience"></a>
## Model Experience

None, as the library only opens a page on the host and registers nothing model-facing.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe the handoff a caller gets. They are current package constraints.

- **Success means handed off, not shown** — the promise resolves when the platform opener accepts the URL; a browser that then fails to render the page is not reported.
- **SSH is the only remote signal** — a container or remote-desktop launch without SSH variables still opens a browser on the host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The library performs one host action per call and owns no event stream or mutable relation.
