---
description: "The /login and /logout slash commands for users signing in to a provider account from a conversation, answering a flow's questions, or removing a stored credential."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-login

English | [中文](README.zh.md)

## Summary

`dsh-command-login` lets you sign in to a provider account from the conversation composer instead of a settings form: `/login` lists every provider that offers a sign-in and whether a credential is stored, `/login <provider>` starts that provider's authorization flow and echoes its first instruction, and `/login <provider> <answer>` answers the question the flow is waiting on — a login method, a pasted code. `/logout <provider>` withdraws a running attempt and deletes the stored record. Choose it for credentials that only a human can obtain, such as the ChatGPT OAuth grant behind the `openai-codex` route; a plain API key is entered on the Models page instead. Neither command records its input in the session log, so a pasted code or key never enters the transcript.

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

Mount the plugin beside `dsh-commands`, `dsh-credentials`, and `dsh-authorization`; the shipped `dsh-base` bundle does so, so every base-backed profile with a command adapter (the Web app) has both commands.

### When to choose it

Choose it when a provider's credential comes from a conversation with a human — an OAuth sign-in, a device code — and the harness must obtain it from a running session. Leave it out of a composition without an authorization service; the commands then answer that sign-in is unavailable.

### Minimal configuration

```yaml
- id: command-login
  name: '@deepseek-ai/dsh-command-login'
  config:
    progressTimeoutMs: 5000   # optional; how long one invocation waits for the flow's next step
```

| Field | Default | Meaning |
|---|---|---|
| `progressTimeoutMs` | `5000` | How long one `/login` invocation waits for the flow's next notice or question before answering with what it has |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-command-login) is the exhaustive source for every accepted field.

### Running a sign-in

Type `/login` to see the providers that offer a sign-in, each as `<provider> — <label>: signed in | not signed in | signing in…`. Then:

| Command | Effect |
|---|---|
| `/login <provider>` | Start the flow with its preferred method and return its first instruction; while an attempt runs, report its latest notice and pending question instead |
| `/login <provider> <method>` | Start the flow with a named method, by id or label |
| `/login <provider> <answer>` | Answer the pending question: an option id or label for a choice, the typed value for a text or secret question |
| `/logout <provider>` | Withdraw a running attempt and delete the stored credential |

Each acknowledgement names the provider and its state, then the flow's latest notice — with `Open: <url>` and `Code: <code>` lines when the flow supplied them — and the pending question with the exact command that answers it. An attempt keeps running after the command returns; a page opened in a browser can complete it without another command, and the next `/login <provider>` reports `signed in.`, `sign-in cancelled.`, or `sign-in failed: <reason>`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the commands drive the seam; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The plugin is one surface for the authorization seam: it supplies the interaction half of `ctx.authorization.begin()` and turns the seam's notice/prompt vocabulary into transcript rows. Because a command returns once, a flow's questions are parked as pending state keyed by credential, and the next invocation for that provider answers them; a notice or question that arrives within the configured wait is included in the current acknowledgement, anything later is reported by the next one.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: attempt bookkeeping, the seam interaction, answer matching, transcript text, both command handlers |

### Attempt lifecycle

`startAttempt` calls `begin()` with an interaction whose `notify` appends to the attempt's notices and whose `prompt` parks a pending question. A flow withdrawing its question through the prompt's own signal rejects it with the `WITHDRAWN` code, which is not a decline; settlement clears any question left open. `/logout` cancels through the seam, so the flow's own abort handling withdraws its questions, then deletes the record.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the command contract is not enough. They move from the seam these commands drive to the flows it runs and the user guide.

- [Authorization seam](../authorization/README.md) — flows, notices, prompts, and the one-attempt-per-key rule.
- [Credential store](../credentials/README.md) — the records a flow commits and `/logout` deletes.
- [pi-ai adapter sign-in](../../llm/llm-pi-ai/README.md) — the provider flows these commands run, including the ChatGPT OAuth grant.
- [Configure models](../../../docs/user/guide/providers.md) — the user-facing walkthrough for signing in with a subscription.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-command-login) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the commands run authorization flows and edit credential records; they register nothing model-facing.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe what a sign-in through the composer can and cannot do. They are current package constraints.

- **Command adapters only** — headless, ACP, and JSON-RPC surfaces have no command plane, so a sign-in there needs another surface.
- **One question at a time is visible** — a flow that asks several questions in quick succession shows only the latest; earlier ones are answered in order through the same command.
- **No automatic browser** — a page the flow names is returned as text for the human to open; a browser-callback method needs that browser to reach the harness host's callback port.
- **Secret answers echo nowhere but are typed in the composer** — `secret` prompts are answered through the same command line; the input is kept out of the session log but not out of the composer's own history.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package's whole output is command results and calls into the authorization and credential seams, which own every durable relation.
