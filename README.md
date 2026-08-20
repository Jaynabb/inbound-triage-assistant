# Inbound Triage Assistant

Triages a shared-inbox queue with an LLM. Each message gets a one-line summary,
a category, a priority, and a suggested next action.
Built for the Arootah AI Product Engineer take-home.

The reasoning behind the design decisions is in **[RATIONALE.md](RATIONALE.md)**
— that's the part worth reading.

## Quick start

```bash
npm install
cp .env.example .env.local     # add your ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Click **Triage 13 messages**. Takes about 10 seconds.

Two useful things from the command line:

```bash
# score the model against the hand-built answer key
node --env-file=.env.local scripts/eval.mts

# check the pre-flight filter's assertions
node scripts/verify-signal.mts
```

**The API key never reaches the browser.** Triage runs in a route handler
(`app/api/triage/route.ts`), so the Anthropic client only ever exists in the
Node process.

## Design choices and tradeoffs

**Next.js + TypeScript, hand-rolled rather than `create-next-app`.** The brief
asks for a lean tool, and every file here is one I can explain. Boilerplate I
didn't choose would be dead weight.

**JSON file as the data layer, not Airtable.** The brief scores them equally,
and a local file means the whole thing runs with `npm run dev` and no external
setup. Airtable would have cost hours and bought nothing for a 13-message queue.
Sketch of how I'd model it in Airtable is below.

**Results aren't persisted, and that's deliberate.** The messages are read from
the file; the triage results are held in memory for as long as the tab is open.
Refresh and they're gone, and running it again costs another set of API calls.
Nothing in the brief asked for storage, and it calls a single-user local tool
"exactly right" — this is a screen you look at to decide what to handle first,
not a system of record. In production the results land in the Messages table
described below. Worth flagging the gap rather than leaving it to be found: the
Airtable sketch stores triage output, the running app does not.

**Haiku 4.5, `temperature: 0`.** Classification against a tight schema is what a
small fast model is for. Temperature 0 because this is classification, not
writing — re-running the queue shouldn't shuffle the categories. Configurable
via `TRIAGE_MODEL`.

**Seven categories, not the four suggested.** `partner`, `recruiter` and
`unclear` were added because three messages didn't fit. See RATIONALE (a).

**Priority is one question: what breaks if this waits?** Something breaks today
is high, nothing breaks but someone's waiting is medium, nothing breaks and
nobody's waiting is low. The question says nothing about money on purpose — an
$8M prospect with no deadline is medium, because nothing breaks if he waits. The
amount goes in the summary where a reader can see it; it just doesn't move him
up the queue.

**I built a separate value field and removed it.** The brief asks for four
things and value was a fifth I'd added. Once priority was one question, the
second axis was answering something nobody asked, and "high priority, low value"
read as contradictory even though both halves were true.

**Two junk messages are filtered before the API call**, and the filter reads the
message body only — never the subject or sender. `inb-005` has no subject and is
the most urgent message in the inbox. See RATIONALE (d).

**An answer key, written by hand before running the model** (`eval/answer-key.json`),
turns "looks about right" into a number. `scripts/eval.mts` scores against it.

## How I'd model this in Airtable

Two tables, linked on the sender's email.

```
Clients                    Messages
─────────────              ──────────────────────────
name                       from_email
email          ◄────────── Client         (linked)
owning_advisor             received_at
                           category / priority
                           summary / next_action
                           status
```

The link does real work. Right now the model decides whether someone is an
existing client by reading the text — Bob says he's a client, so it believes
him. With this link you match the sender's email against the Clients table
instead, which is a fact rather than a guess. **Don't ask the model to work out
something the firm already knows.** Use the model for judgment — intent,
urgency, tone. Use the database for facts.

It also gives you routing for free: once a message is linked to a client, you
know which advisor owns them.

## One automation I'd add (n8n)

```
trigger:  new message arrives in the shared inbox
   ↓
filter:   is it corrupted?  is there anything in it?
          ├─ no  → park it in "couldn't read". Never call the model.
          └─ yes ↓
action:   call the triage endpoint
          → write the result to the Messages table
          → if priority is high, notify the advisor who owns
            that client
```

**The filter step is code that already exists** — it's `lib/signal.ts`, and in
production it moves out of the app and into an n8n Code node so it runs before
the model call instead of after. It asks two questions:

1. **Is the message corrupted?** Does it contain characters a person can't
   type — null bytes, control codes, or the `�` left behind when text is
   decoded with the wrong encoding? `inb-011` fails here.
2. **Is there anything in it?** Count the letters and numbers. `inb-010` is a
   single period, so it has zero.

Everything else goes through. The eleven real messages carry 67–147 letters and
digits and none are corrupted, so nothing sits near either line.

The no-branch **parks** messages rather than deleting them. If mail starts
arriving broken you want to watch that rate climb, not have it vanish quietly —
which is the same reason both rows still render in the UI instead of
disappearing.

The point is the trigger. Running triage on a schedule is the wrong shape: if
the batch runs at 8am and an angry client writes at 9am, nobody sees it until
the next morning — the one time-critical message is the one the system is
slowest on. Firing on arrival fixes that without needing more capacity.

Only `high` notifies anyone. If everything pushes, nothing is a signal.

I've deliberately not named the notification channel. Arootah's stack mentions
Airtable, n8n/Zapier and a CRM, and I don't know what they use for alerts — so
that's a question rather than an assumption.

## How I used AI

I used it the whole way through. Claude Code to build it, Claude for the triage
itself. What I spent my own time on was the decisions: what the categories
should be, what priority actually means, what to do when the model breaks the
rules, and building the answer key by hand before I let the model near it.

**Where I overrode it.** While we were working out the n8n automation, it wrote
a step that sends a Slack message to the advisor. I stopped it, because Slack
isn't mentioned anywhere in the job description or the brief. The tools listed
are Airtable, n8n, Zapier and a CRM. It added a tool nobody said they use.

That's the thing to watch for. It wasn't wrong in a way I'd catch by knowing
more about the subject. It just sounded right. Checking it against what was
actually written took ten seconds.

So I took the channel out and said the notification goes to whoever owns that
client, through whatever the firm already uses. That's a better answer anyway. I
don't know what they run on, and asking beats guessing when you're the only
engineer walking into someone else's setup.

_(Second one if it's useful: it capped the model's `reasoning` field at 300
characters. I asked where that number came from, and said trimming an
explanation could cut out important context. It couldn't defend the limit, so we
dropped it. That's written up in RATIONALE (b).)_

## Notes

- `.env.example` is committed; `.env.local` is gitignored and holds the key.
- `prompts/` has the system prompt and notes on how structured output is
  enforced.
- The prompt is generated from `lib/schema.ts` rather than written separately,
  so the model's rulebook can't drift from the validation.
