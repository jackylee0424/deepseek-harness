# Agent Note: Provider sign-in commands

Status: implemented

English | [中文](2026-09-02-provider-sign-in-commands.zh.md)

## Problem

The authorization seam and the pi-ai adapter's login flows existed, but no shipped composition mounted `dsh-authorization` and no surface ever called `begin()`: the Models page collects keys only, and neither the CLI nor the command plane offered a sign-in. A credential that only a human can obtain — the ChatGPT OAuth grant behind the `openai-codex` route, which is how a Codex subscription serves the main model — was therefore unreachable in the product, even though the seam, the flow, and the credential record format were all in place. The repository owner wants their Codex subscription as the default model.

## Decision

`dsh-base` mounts `@deepseek-ai/dsh-authorization` after the credential store, so every adapter flow registers in every base-backed profile, and mounts `@deepseek-ai/dsh-command-login`, which owns `/login` and `/logout` as the seam's conversation surface.

- `/login` lists every registered flow with its stored-record state; `/login <provider> [method]` starts an attempt through `ctx.authorization.begin()` with an interaction that appends notices and parks questions per credential key; `/login <provider> <answer>` resolves the parked question, matching a `select` option by id or label; `/logout <provider>` cancels through the seam and deletes the record.
- An attempt keeps running after its command returns. Each invocation waits `progressTimeoutMs` (default five seconds) for the flow's next notice or question, then answers with the provider's state, the latest notice (`Open:` and `Code:` lines when present), and the pending question with the command that answers it. A question the flow withdraws through the prompt's own signal rejects with `WITHDRAWN`, which is not a decline; a question left open at settlement is dropped.
- Both commands set `recordInput: false`, so a pasted code or key never enters the session log; the `command/done` text carries only the flow's instructions.
- The providers guide documents the subscription path: declare the `openai-codex` route from the Models page with a blank key, run `/login openai-codex`, pick `browser` or `device_code`, then choose a GPT model in the picker.

## Verification

Package tests drive both commands through the real command registry, local credential store, and authorization service against a scripted flow shaped like pi-ai's Codex login: listing, method selection by id and label, the page notice, a code question answered and withdrawn, the progress timeout, declined and failed settlements, an attempt owned by another surface, sign-out of running and stored states, and the composition without an authorization service. The `dsh-base` bundle test asserts both rows; the web command-menu golden pins the two entries.

## Alternatives considered

**A sign-in button on the Models page.** Rejected for now because it needs a new Remote contract, client catalog regeneration, and a prompt-rendering dialog on the browser side; the command plane already renders text rows and reaches the same seam, so it ships the capability first and a page can join it later.

**A CLI subcommand.** Rejected because the seam's interaction is meant to reach the surface that asked, which for a running Web session is the conversation; a CLI login would boot a second tree against the same credential store to answer questions the Web user cannot see.

**Import the Codex CLI's `auth.json` tokens.** Rejected because it couples the harness to another product's on-disk format and refresh semantics; the OAuth flow pi-ai ships uses the same client and produces a record the adapter refreshes itself.

**Answer the flow's method question automatically.** Rejected because the right method depends on where the browser is: a browser callback on the harness host is the common local case, a device code is the remote one, and only the human knows which.

## Consequences

Every base-backed profile registers the pi-ai sign-in flows and exposes `/login` and `/logout` wherever a command adapter exists; headless, ACP, and JSON-RPC surfaces still have no sign-in path. A signed-in `openai-codex` route lets the picker offer the subscription's GPT models and the saved selection makes one the default. Secret answers travel through the composer, hidden from the log but not from the composer's own history. The command-menu golden and the base row inventory change with the two new rows.
