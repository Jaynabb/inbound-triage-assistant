# Inbound Triage Assistant

Triages a shared-inbox queue with an LLM. Each message gets a one-line summary,
a category, a priority, a business-value signal, and a suggested next action.
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

**Haiku 4.5, `temperature: 0`.** Classification against a tight schema is what a
small fast model is for. Temperature 0 because this is classification, not
writing — re-running the queue shouldn't shuffle the categories. Configurable
via `TRIAGE_MODEL`.

**Seven categories, not the four suggested.** `partner`, `recruiter` and
`unclear` were added because three messages didn't fit. See RATIONALE (a).

**Priority means time pressure only.** Business value is a separate field, so a
big opportunity gets surfaced instead of being hidden inside an urgency score.

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
                           category / priority / value_signal
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
action:   call the triage endpoint
          → write the result to the Messages table
          → if priority is high, notify the advisor who owns
            that client
```

The point is the trigger. Running triage on a schedule is the wrong shape: if
the batch runs at 8am and an angry client writes at 9am, nobody sees it until
the next morning — the one time-critical message is the one the system is
slowest on. Firing on arrival fixes that without needing more capacity.

Only `high` notifies anyone. If everything pushes, nothing is a signal.

I've deliberately not named the notification channel. Arootah's stack mentions
Airtable, n8n/Zapier and a CRM, and I don't know what they use for alerts — so
that's a question rather than an assumption.

## How I used AI

Heavily, throughout — Claude Code for the build, Claude for the triage itself.
The parts I spent real time on were the decisions: what the categories should
be, what priority actually means, what to do when the model breaks its contract,
and building the answer key by hand before letting the model near it.

**Where I overrode it:** while working out the n8n automation, the assistant
drafted a step that notified the owning advisor over Slack. I stopped it,
because nothing in the job description or the brief mentions Slack — the stack
they name is Airtable, n8n/Zapier and a CRM. It had invented a tool the customer
never mentioned, and it read as perfectly reasonable.

That's the failure mode worth watching for. It wasn't a wrong fact I could catch
by knowing better; it was a confident, plausible detail with nothing behind it.
Checking it against the source took ten seconds. The fix was to describe what
should happen and leave the channel as a question for the client — which is a
better answer anyway, especially walking into someone else's stack as the only
engineer.

_(A second one, if useful: the assistant capped the model's `reasoning` field at
300 characters. I asked where the number came from and pushed back that trimming
an explanation could cut important context. It couldn't defend the limit, so we
removed it. Written up in RATIONALE (b).)_

## Notes

- `.env.example` is committed; `.env.local` is gitignored and holds the key.
- `prompts/` has the system prompt and notes on how structured output is
  enforced.
- The prompt is generated from `lib/schema.ts` rather than written separately,
  so the model's rulebook can't drift from the validation.
