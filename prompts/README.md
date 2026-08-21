# Prompts

## Where the prompt lives

`lib/prompt.ts`. It's a hand-written template with two generated sections —
roughly a quarter of the final text is generated, the rest is prose I wrote.

`buildSystemPrompt()` renders the **category list** and the **priority
definitions** from `CATEGORY_DEFINITIONS` and `PRIORITY_DEFINITIONS` in
`lib/schema.ts`. Those are the same objects that produce the zod enum and the
tool schema sent to the API, so the model's rulebook and the validator can't
disagree about what a valid category is.

Everything else — the role, the worked examples, the honesty rules, the
explanation of what priority means — is written by hand in `prompt.ts`.

**Why generate that part.** The usual failure is a prompt maintained next to a
schema maintained separately: someone adds a category to the enum, forgets the
prompt, and the model is never told the category exists. It doesn't error, it
just quietly never emits it. Here there's one definition and both read from it.

**Adding a category is two lines in one file** — the name in `CATEGORIES` and
its description in `CATEGORY_DEFINITIONS`. You can't do one without the other:
`CATEGORY_DEFINITIONS` is typed as `Record<Category, string>`, so leaving the
description out is a compile error naming the exact field you missed, not a
silent gap. I tested this by adding a `press` category, getting the build
error, completing it, watching it appear in the validation and the tool schema
without touching another file, and then removing it again.

`prompts/triage.system.txt` is a **snapshot** of the rendered output, committed
so the prompt is readable without running anything. Regenerate with:

```bash
node scripts/dump-prompt.mts > prompts/triage.system.txt
```

## Structure

Five parts, in this order. The first is the opening paragraph; the other four
are headed sections in `prompts/triage.system.txt`.

1. **Role and stakes** *(opening paragraph, no heading)* — who the firm is, and
   that a human reads the output to decide what to handle first.
2. **Categories** *(generated)* — the seven, each with a one-line definition.
3. **Priority** *(definitions generated, prose hand-written)* — stated as a
   single question, *what breaks if this waits?*, plus two explicit
   prohibitions: deal size never raises priority, and the sender doesn't set it
   in either direction.
4. **Worked examples** — three, showing the rule both ways (big money with no
   deadline → medium; trivial admin with a 24-hour deadline → high; unsolicited
   outreach → low). Deliberately invented, never messages from the queue.
5. **Honesty rules** — when to use `needs_human`, that `(individual)` and
   `(unknown)` are placeholders rather than company names, and that a missing
   subject or sender means nothing on its own.

**Not in the prompt on purpose:** the business-day service standards attached
to each band. Those live in the UI. Putting them in the prompt cost a point on
the eval — the model started reasoning about how attentive to be rather than
about what breaks. See the note in `lib/schema.ts`.

The per-message user turn (`buildUserPrompt`) labels each metadata field and
prints `(empty)` for blanks rather than omitting them, so the model can see a
field is absent instead of inferring it from a gap.

## Parameters

| setting | value | why |
|---|---|---|
| model | `claude-haiku-4-5-20251001` | Classification against a tight schema is what a small fast model is for. Configurable via `TRIAGE_MODEL`. |
| `temperature` | `0` | This is classification, not composition. Re-running the queue must not shuffle the categories. |
| `max_tokens` | 1024 | Comfortably above the largest valid tool call, and the only bound on `reasoning`, which has no length cap. |
| `tool_choice` | `{type: "tool", name: "triage"}` | Forced — the model cannot reply with prose. |
| concurrency | 4 | Sequential wastes wall-clock; unbounded rate-limits at real volume. |

## How structured output is enforced

Three layers, each catching what the others cannot.

**1. Forced tool use.** `tool_choice` pins the model to the `triage` tool, whose
`input_schema` is generated from the zod schema by `zod-to-json-schema`. The API
constrains the *shape* — no prose, no code fences, no missing fields, no invalid
enum values. This layer has never failed.

**2. zod validation.** Tool use guarantees types and enums. It does not
guarantee the values make sense: a `summary` meant to be one line can come back
as four and still be perfectly valid JSON, and `confidence` has to actually sit
between 0 and 1.

*Evidence it isn't redundant, from earlier in the build:* `reasoning` used to
carry a 300-character cap, and 3 of 11 calls returned perfectly-shaped JSON that
overran it. Tool use passed all three; only zod caught them. That cap has since
been removed — it was a constraint I'd invented and couldn't justify — so the
example is history rather than current behaviour, but it's the clearest
demonstration that layers 1 and 2 do different jobs.

**3. Tiered repair.** Not every defect deserves the same response:

- `category` / `priority` **drive routing.** A wrong value misroutes a client,
  so these hard-fail and trigger one corrective retry with the specific
  validation error fed back. Guessing a replacement myself would do the same
  damage as the model's bad guess, except nothing would look broken.
- `summary` / `next_action` are **one-line display fields**, capped at 200
  characters because the brief asks for a one-line summary. An overrun is
  cosmetic, so it's trimmed rather than rejected and never costs an API call.
- `reasoning` has **no cap at all.** It's the audit trail, the UI collapses it
  behind a toggle, and trimming an explanation cuts the qualifier off the end —
  a truncated audit record is worse than a long one.

Current run: **0 retries and 0 truncations across 11 calls.**

**One bug found by running it, not reading it.** The retry sends its correction
inside a `tool_result` block with `is_error: true`. The first implementation
sent plain text, which the API rejects immediately after an assistant turn
containing `tool_use` — so the retry path 400'd on exactly the messages that
needed repairing, which is the worst possible place for a bug to hide.
