# CLAUDE.md — Inbound Triage Assistant

Triages a shared-inbox queue for Northwind Advisors (fictional advisory firm)
with an LLM. Per message: one-line summary, category, priority, next action.
The queue is **not all email** — email, web form, LinkedIn and transcribed
voicemail all arrive in the same seven-field shape.

Read `RATIONALE.md` for why any of this is the way it is. This file is how to
work in it.

## Run

```bash
npm run dev                                    # http://localhost:3000
node --env-file=.env.local scripts/eval.mts    # score against the answer key
node scripts/verify-signal.mts                 # assert the pre-flight filter
TRIAGE_FAIL_IDS=inb-003 npm run dev            # force a real 529 on one message
```

Node 22.18+ — the scripts are `.mts` that node runs directly, no build step.
`ANTHROPIC_API_KEY` lives in `.env.local` (gitignored). **Never print it, never
cat that file.**

## The pipeline, in order

| step | file | what it does |
|---|---|---|
| load | `app/page.tsx` | server component reads `data/inbound.json` |
| trigger | `app/TriageBoard.tsx` | button POSTs `/api/triage` (stands in for n8n) |
| endpoint | `app/api/triage/route.ts` | **exists so the key never reaches the browser**; optional `{ids}` body = retry subset |
| fan-out | `lib/triage.ts` → `triageAll` | bounded concurrency, default 4 |
| pre-flight | `lib/signal.ts` → `checkSignal` | park broken/blank without spending a call |
| prompt | `lib/prompt.ts` | system prompt **generated from** `schema.ts` |
| call | `lib/triage.ts` → `triageOne` | forced `tool_choice`, one corrective retry |
| validate | `lib/schema.ts` → `TriageResultSchema` | zod, after the tool schema |
| judgment | `lib/triage.ts` → `finalise` | applies `CONFIDENCE_FLOOR` |
| render | `app/TriageBoard.tsx` | groups into bands, nothing hidden |

Statuses out: `ok`, `review`, `skipped_malformed`, `error`.

## The five seams

New behaviour goes in exactly one of these. Name the seam before editing.

1. **Pre-flight** (`checkSignal`) — anything not worth an API call
2. **Shape** (forced tool use + `extractToolInput`) — prose, missing fields, bad enum
3. **Semantics** (`safeParse`) — valid JSON that is still wrong
4. **Transport** (the `catch` in `triageOne` + `explainFailure`) — 401 / 429 / 529 / network
5. **Judgment** (`finalise` + `CONFIDENCE_FLOOR`) — the model being confidently wrong

Some problems fit none of them — "it labelled a real client as spam" is the
eval, the confidence floor, and the operator being able to override. Say so
rather than inventing a code path.

## Invariants — do not break these

These are measured or reasoned decisions, not preferences.

1. **`lib/schema.ts` is the single source of truth.** Categories and priorities
   are defined once; the zod enum, the tool schema, the system prompt and the UI
   legend all derive from it. **Never hand-write a category or priority into the
   prompt text.** Adding a category = add the key, then the compiler forces the
   definition.
2. **Service standards ("within 2 business days") live in the UI, never in
   `PRIORITY_DEFINITIONS`.** The model reads those definitions. Putting the
   standards there measurably cost a point on the eval — it reasoned about how
   attentive to be instead of about what breaks.
3. **Priority answers one question: what breaks if this waits?** Not deal size,
   not the sender saying "urgent" or "no rush".
4. **Routing fields are never guessed.** Invalid `category`/`priority` → feed the
   specific error back inside a `tool_result` (a plain text reply 400s), one
   retry, then surface an honest error. Never substitute a default.
5. **Display fields are trimmed silently; `reasoning` is never truncated.** It's
   the audit trail and the qualifier lives at the end.
6. **The pre-flight filter reads the body only.** Never the subject, never the
   sender — `inb-005` is a voicemail with no subject and the most urgent message
   in the inbox.
7. **`skipped_malformed` ≠ `error`.** Bad data coming in vs. something broken on
   our end. Different rows, different actions.
8. **Nothing disappears.** Every message renders somewhere, with a reason.
9. **The key stays server-side.** Triage runs in the route handler only.

## Scope — the brief excludes these

No auth, no deploy/Docker, no telemetry, no coverage targets, no multi-user.
Single-user local tool is the correct shape. **Don't gold-plate.**

## After any prompt or schema change

Run the eval. Both Haiku 4.5 and Sonnet 5 currently score 24/24 with 0 retries.
`eval/answer-key.json` was written by hand before the model ever ran, so it's
the spec — if a change moves a message, the eval is right and the change needs
justifying. Adding a category can move messages that were already correct.

## Known gaps (deliberate, not oversights)

- `temperature: 0` is hardcoded (`lib/triage.ts:243`), so `TRIAGE_MODEL` breaks
  on models where the parameter is deprecated — Sonnet 5 400s on it.
- No request timeout, no body-length cap, no prompt caching on the (static)
  system prompt.
- Triage results aren't persisted; in production they'd land in the Messages
  table sketched in the README.

## How to work in this repo

Small diffs, one change at a time. Say which seam a change belongs to before
making it. Comments explain **why**, not what — match the existing density.
Prefer deleting a rule over adding a threshold: there is no tunable number
anywhere in the filter and it should stay that way.

## Showing a change on GitHub

After making a change, commit and push it so the diff can be opened in the
browser. Always surface both links:

```bash
git add -A && git commit -m "<what changed>" && git push -u origin live-session
```

- **this change** — `https://github.com/Jaynabb/inbound-triage-assistant/commit/<sha>`
- **everything so far** — `https://github.com/Jaynabb/inbound-triage-assistant/compare/main...live-session`

`main` is the submitted version and is never pushed to. The compare link is the
running diff of the whole session against it.
