# Prompts

## Where the prompt actually lives

`lib/prompt.ts` — and it is **generated**, not hand-written.

`buildSystemPrompt()` renders the category and priority sections from
`CATEGORY_DEFINITIONS` and `PRIORITY_DEFINITIONS` in `lib/schema.ts`, which are
the same objects that produce the zod enum, the tool schema sent to the API,
and the legend in the UI.

The reason is drift. The usual failure is a prompt written by hand next to a
schema written separately: someone adds a category to the enum, forgets the
prompt, and the model never emits it — or worse, emits it inconsistently. Here
there is one definition of the taxonomy and everything reads from it. Adding a
category is a one-line change in `schema.ts`.

`prompts/triage.system.txt` in this folder is a **snapshot** of the rendered
output, committed so the prompt is reviewable without running the code.
Regenerate with:

```bash
node scripts/dump-prompt.mts > prompts/triage.system.txt
```

## Structure

The system prompt has five parts, in this order:

1. **Role and stakes** — who the firm is, that a human reads the output to
   decide what to handle first.
2. **Categories** — the seven, each with a one-line definition.
3. **Priority** — with the explicit statement that it means *time pressure
   only*, and an explicit prohibition on letting deal size affect it.
4. **Worked examples** — three, demonstrating the priority/value split in both
   directions (big money with no deadline → medium; trivial admin with a
   24-hour deadline → high; unsolicited outreach → low).
5. **Honesty rules** — when to use `unclear`, that `(individual)` and
   `(unknown)` are placeholders rather than company names, and that a missing
   subject or sender means nothing on its own.

The per-message user turn (`buildUserPrompt`) labels each metadata field and
prints `(empty)` for blanks rather than omitting them, so the model can see
that a field is absent instead of inferring it from a gap.

## Parameters

| setting | value | why |
|---|---|---|
| model | `claude-haiku-4-5-20251001` | Classification against a tight schema is what a small fast model is for. Configurable via `TRIAGE_MODEL`. |
| `temperature` | `0` | This is classification, not composition. An operator re-running the queue must not see categories shuffle. |
| `max_tokens` | 1024 | Comfortably above the largest valid tool call. |
| `tool_choice` | `{type: "tool", name: "triage"}` | Forced — the model cannot reply with prose. |
| concurrency | 4 | Sequential wastes wall-clock; unbounded rate-limits at real volume. |

## How JSON output is enforced and validated

Three layers, each catching what the others cannot:

1. **Forced tool use.** `tool_choice` pins the model to the `triage` tool,
   whose `input_schema` is generated from the zod schema by
   `zod-to-json-schema`. The API constrains the *shape* — no prose, no code
   fences, no missing fields, no invalid enum values.

2. **zod validation.** Tool use guarantees types and enums; it does **not**
   guarantee the values make sense. Measured: 3 of 11 calls returned
   perfectly-shaped JSON containing a `reasoning` string over its 300-character
   limit. Only zod caught that.

3. **Tiered repair.** Not every defect deserves the same response:
   - `category` / `priority` / `value_signal` **drive routing** — a wrong value
     misroutes a client, so these hard-fail and trigger one corrective retry
     with the specific validation error fed back.
   - `summary` / `reasoning` are **display only** — these are truncated rather
     than rejected, so a long explanation never costs an API call.

   This took the retry rate from 45% to 0% with no loss of accuracy.

The retry sends its correction inside a `tool_result` block with
`is_error: true`, not as plain text. The API rejects a text reply immediately
after an assistant turn containing `tool_use`, so the first implementation
400'd on exactly the messages that needed repair.
