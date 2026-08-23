# Inbound Triage Assistant

Triages a shared-inbox queue with an LLM. Every message gets a one-line summary,
a category, a priority and a suggested next action. The queue isn't all email —
messages arrive by email, web form, LinkedIn and transcribed voicemail, and the
channel changes what you do about them.

**[RATIONALE.md](RATIONALE.md)** has the reasoning behind every decision below.
This file is how to run it and what it does.

## Quick start

```bash
npm install
cp .env.example .env.local     # add your ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Click **Triage the inbox** — about 10 seconds. Two checks from the command line:

```bash
node --env-file=.env.local scripts/eval.mts   # score against the hand-built answer key
node scripts/verify-signal.mts                # assert the pre-flight filter
```

**The API key never reaches the browser.** Triage runs in a route handler
(`app/api/triage/route.ts`), so the Anthropic client only exists in the Node
process.

**To see a failure handled:** `TRIAGE_FAIL_IDS=inb-003,inb-006 npm run dev`.
Those two land under *Couldn't reach the model* with the reason on the row while
the other eleven triage normally. Tick the ones worth re-running and the band
retries exactly those in one request.

## What it does with the 13 messages

| id | category | priority — and what breaks |
|---|---|---|
| `inb-002` Dana Whitfield | existing client | **high** — misses her lender's Friday deadline |
| `inb-005` Robert Ellison | existing client | **high** — angry client; left a day, the firm loses him |
| `inb-001` Gregory Palmer | prospect | **medium** — no deadline; the $8M doesn't move him |
| `inb-006` Alicia Tran | prospect | **medium** — asked a real question, waiting on us |
| `inb-007` Jordan Massey | partner | **medium** — waiting on a reply, nothing breaks today |
| `inb-009` Sam Cho | needs human review | **medium** — someone's waiting, but on what is unknown |
| `inb-012` Helen Ortiz | existing client | **medium** — waiting on scheduling, no date named |
| `inb-013` Nathan Brooks | prospect | **medium** — referral waiting on a call, no deadline |
| `inb-003` Marcus Reed | vendor | **low** — unsolicited; nothing breaks if he never hears back |
| `inb-004` Priya N. | recruiter | **low** — recruiting; nobody at the firm is waiting |
| `inb-008` Market Daily | spam | **low** — newsletter; archiving it is handling it |
| `inb-010` unsigned | — | **parked** — blank, no letters or numbers in it |
| `inb-011` unsigned | — | **parked** — broken, characters that aren't readable text |

The two parked rows never reach the model. The other eleven match
`eval/answer-key.json`, written by hand before the model ran — that agreement is
the 24/24 `scripts/eval.mts` reports.

## Design choices and tradeoffs

- **Next.js + TypeScript, JSON file as the data layer.** The brief scores
  Airtable and local storage equally, and a file means the whole thing runs with
  `npm run dev` and no external setup.
- **`claude-haiku-4-5-20251001`, `temperature: 0`.** Classification against a
  tight schema is what a small fast model is for, and re-running the queue
  shouldn't shuffle the categories. `TRIAGE_MODEL` overrides it.
- **Seven categories.** `partner`, `recruiter` and `needs_human` exist because
  three messages don't fit the four the brief suggests.
- **Priority is one question: what breaks if this waits?** A deadline passes, a
  complaint escalates, a client relationship degrades. It says nothing about
  money on purpose — an $8M prospect with no deadline is medium. And the sender
  doesn't set it in either direction: "urgent!" doesn't raise it, "no rush"
  doesn't lower it.
- **The service standards live in the UI, not the prompt.** The model is asked
  what breaks; the operator is shown what the firm commits to.
- **Two junk messages are filtered before the API call.** The filter reads the
  body only, never the subject or sender — `inb-005` has no subject and is the
  most urgent message in the inbox, because voicemails don't have subject lines.
- **A failed call is not an unreadable message.** It gets its own band, a reason
  written for an operator rather than an API payload, and a retry.
- **Triage results aren't persisted.** In production they land in the Messages
  table below.

## How I'd model this in Airtable

```
Clients                    Messages
─────────────              ──────────────────────────
name                       from_email
email          ◄────────── Client         (linked)
client_since               received_at / channel
owning_advisor             category / priority
                           summary / next_action
                           status
```

Two tables linked on the sender's email. Right now the model decides whether
someone is an existing client by reading the text — Bob says he's a client, so
it believes him. With the link that's a lookup rather than a guess: the model is
for judgment, the database is for facts. `client_since` is empty for anyone who
has only ever written in, which is what lets the table hold prospects too, and a
row plus its linked messages is the customer profile the triage reads.

## The n8n automation

**Trigger — on arrival, never on a schedule.** The mailbox is watched (Gmail /
Outlook / IMAP), the web form posts straight to a webhook, voicemail arrives as
a transcript from a transcription service, and LinkedIn needs a paid bridge —
which at one message in thirteen I'd skip in favour of forwarding it manually.

**Actions:** normalise every source into one seven-field shape → park it if the
body is broken or blank, without calling the model → match `from_email` against
the Clients table and attach the **customer profile**: contact details,
`client_since`, the owning advisor and their previous messages, creating the
profile from this message if the sender is new → POST to the triage endpoint →
write the result to Messages → notify the owning advisor, but only if priority
is `high`, because if everything pushes then nothing is a signal.

The profile is what shrinks `needs_human`. Sam Cho's "just following up on our
conversation" is only unclear because the message arrives on its own; attach his
previous thread and there's nothing left to guess. What it must not do is move
the priority — it tells you who is writing, not what breaks.

## How I used AI

Claude Code to build it, Claude for the triage itself. What I spent my own time
on was the decisions: what the categories should be, what priority actually
means, what to do when the model breaks the rules, and the answer key, which I
wrote by hand before the model ran.

**Money isn't urgency.** Left to itself it treated the biggest opportunity in
the queue as the most urgent thing in it — `inb-001` is an $8M prospect, so it
wanted him at the top. But nothing breaks if Gregory waits until Thursday, and
sorting by deal size buries the angry client who actually costs the firm
something. So priority became one question, and the money went in the summary.

**The queue isn't all email.** At one point every message was being handled as
an email, which reads fine until `inb-005`: no subject line, and the most urgent
message in the inbox. He's a voicemail transcript, and voicemails don't have
subject lines — anything keyed on a missing subject would drop every voicemail
this firm ever receives.

## Notes

- `.env.example` is committed; `.env.local` is gitignored and holds the key.
- `prompts/` has the system prompt and notes on how structured output is
  enforced and validated.
- The prompt's category and priority sections are generated from `lib/schema.ts`,
  so the model's rulebook can't disagree with the validation.
