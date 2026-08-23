# Inbound Triage Assistant

Triages a shared-inbox queue with an LLM. Each message gets a one-line summary,
a category, a priority, and a suggested next action.

The queue isn't all email — messages arrive by email, web form, LinkedIn and
transcribed voicemail, and the channel changes what you do about them. How all
four funnel into one triage is [below](#how-messages-get-into-the-triage-n8n).

Built for the Arootah AI Product Engineer take-home. The reasoning behind the
design decisions is in **[RATIONALE.md](RATIONALE.md)**.

## Quick start

```bash
npm install
cp .env.example .env.local     # add your ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Click **Triage the inbox**. Takes about 10 seconds.

Two useful things from the command line:

```bash
# score the model against the hand-built answer key
node --env-file=.env.local scripts/eval.mts

# check the pre-flight filter's assertions
node scripts/verify-signal.mts
```

**To see a failure handled**, run with one message set to fail:

```bash
TRIAGE_FAIL_IDS=inb-003,inb-006 npm run dev
```

Those two come back under *Couldn't reach the model* with the reason on each row
— the model was overloaded and didn't answer on either attempt — while the other
eleven triage normally. One call failing costs one row, not the queue.

Recovery is per-message. Tick the rows worth re-running and the band retries
exactly those in one request; with nothing ticked it offers the whole band. Drop
to a single failure and the checkboxes go away — that row just gets a **Retry
this message** button, because choosing from a list of one isn't a choice.

**The API key never reaches the browser.** Triage runs in a route handler
(`app/api/triage/route.ts`), so the Anthropic client only ever exists in the
Node process.

## What it does with the 13 messages

In board order — handle today, then within 2 business days, then within 3. The
priority column carries the reason, because a band nobody can justify is a band
nobody should trust.

| id | channel | from | category | priority — and what breaks | summary |
|---|---|---|---|---|---|
| `inb-002` | web form | Dana Whitfield | existing client | **high** — misses her lender's Friday deadline | Existing client Dana Whitfield needs updated portfolio statement by Friday for mortgage lender |
| `inb-005` | voicemail | Robert Ellison | existing client | **high** — angry client; left a day, the firm loses him | Existing client Bob Ellison disputes a fee on his statement; requests callback today |
| `inb-001` | email | Gregory Palmer | prospect | **medium** — no deadline; the $8M doesn't move him | $8M liquidity event; seeking tax-efficient planning and family office setup |
| `inb-006` | email | Alicia Tran | prospect | **medium** — asked a real question, waiting on us | Prospect asking about minimum account size and fee structure |
| `inb-007` | web form | Jordan Massey (Cedar Ridge Wealth) | partner | **medium** — waiting on a reply, nothing breaks today | RIA owner exploring referral partnership arrangement |
| `inb-009` | email | Sam Cho | needs human review | **medium** — someone's waiting, but on what is unknown | Follow-up on prior conversation; next steps unclear |
| `inb-012` | email | Helen Ortiz | existing client | **medium** — client waiting on scheduling, no date named | Existing client Helen Ortiz requesting quarterly review scheduling, mornings preferred |
| `inb-013` | email | Nathan Brooks | prospect | **medium** — referral waiting on a call, no deadline | Prospect referred by existing client Dana Whitfield; seeking family planning intro call |
| `inb-003` | email | Marcus Reed (Lumen Analytics) | vendor | **low** — unsolicited; nothing breaks if he never hears back | Lumen Analytics pitching portfolio analytics platform; requesting 20-min demo next week |
| `inb-004` | linkedin | Priya N. (TalentBridge Recruiting) | recruiter | **low** — recruiting; nobody at the firm is waiting | Recruiter pitching senior role opportunity with their client |
| `inb-008` | email | unsigned (Market Daily) | spam | **low** — newsletter; archiving it is handling it | Automated market newsletter from Market Daily |
| `inb-010` | web form | unsigned | — | **parked** — never reaches the model | blank — the message contains no letters or numbers |
| `inb-011` | email | `=?utf-8?B?` | — | **parked** — never reaches the model | broken — the message contains characters that aren't readable text |

The eleven that reach the model match the answer key in `eval/answer-key.json`,
written by hand before it ran — that agreement is the 24/24 `scripts/eval.mts`
reports.

Read the high rows against `inb-001`. Dana and Bob are the only two where
something breaks today, and neither is the biggest opportunity on the page.
Gregory is, and he waits until Thursday.

## Design choices and tradeoffs

**Next.js + TypeScript, set up by hand.** There's no generated scaffolding in
the repo — every file in it is one the tool uses.

**JSON file as the data layer, not Airtable.** The brief scores them equally,
and a local file means the whole thing runs with `npm run dev` and no external
setup. For a 13-message queue, Airtable adds setup without adding capability.
The Airtable model is sketched below.

**Triage results aren't persisted.** The messages are read from the file; the
results are held in memory for as long as the tab is open. Refresh and they're
gone, and running it again costs another set of API calls. This is a screen you
look at to decide what to handle first, not a system of record. In production
the results land in the Messages table described below — so the Airtable sketch
stores triage output and the running app does not.

**`claude-haiku-4-5-20251001`, `temperature: 0`.** Classification against a tight
schema is what a small fast model is for. Temperature 0 because this is
classification, not writing — re-running the queue shouldn't shuffle the
categories. `TRIAGE_MODEL` overrides the model; `scripts/eval.mts --model <id>`
scores any model against the same answer key.

**Seven categories.** `partner`, `recruiter` and `needs_human` are there because
three messages in the queue don't fit the four the brief suggests. See
RATIONALE (a).

**Priority is one question: what breaks if this waits?** Breaking is concrete —
a deadline passes, a complaint escalates, or a client relationship degrades.
Something breaks today is high, nothing breaks but someone's waiting is medium,
nothing breaks and nobody's waiting is low. `inb-005` is the clearest high in
the queue: an existing client angry enough about a fee to phone instead of
write, and a client left waiting while he's angry is a client who leaves.

The question says nothing about money: an $8M prospect with no deadline is
medium, because nothing breaks if he waits. The amount goes in the summary where
a reader can see it; it doesn't move him up the queue.

**The sender doesn't set the priority, in either direction.** A vendor wanting
a reply this week isn't high, and a prospect opening with "no rush at all" isn't
low — she still asked a question and is waiting on an answer. The firm sets its
service standard, not the person writing in.

**On screen those bands are service standards** — handle today, within 2
business days, within 3 business days. The band tells the reader what the firm
has committed to, not how urgent the message felt to whoever wrote it.

**The standards live in the UI, not in the model's prompt.** The model is asked
what breaks; the operator is shown what the firm commits to. Framing the bands
as service standards inside the prompt invites the model to reason about how
attentive to be rather than about what breaks. RATIONALE (a) has the eval run.

**Two junk messages are filtered before the API call** — one broken, one blank.
The filter reads the message body only, never the subject or sender: `inb-005`
has no subject and is the most urgent message in the inbox, because it's a
voicemail transcript and voicemails don't have subject lines. See RATIONALE (d).

**`eval/answer-key.json` holds the expected result for all 13 messages**,
written by hand before the model ran. `scripts/eval.mts` scores against it.

## How I'd model this in Airtable

Two tables, linked on the sender's email.

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

The link does real work. Right now the model decides whether someone is an
existing client by reading the text — Bob says he's a client, so it believes
him. With this link it's a lookup rather than a guess. The model is for
judgment — intent, urgency, tone. The database is for facts.

`client_since` is empty for anyone who has only ever written in, which is what
makes the table hold prospects as well as clients: a first-time sender becomes a
row with no start date, and gets one if they sign. A row plus its linked
messages is the customer profile the triage reads.

It also gives you routing for free: once a message is linked to a client, you
know which advisor owns them. How n8n attaches all of this before the model
sees the message is [below](#look-it-up-dont-guess).

## How messages get into the triage (n8n)

**The queue isn't all email.** Of these 13: eight arrive by email, three by web
form, one by LinkedIn and one as a transcribed voicemail. Four different front
doors, and each one gets into n8n a different way:

| channel | how n8n gets it | node | notes |
|---|---|---|---|
| **email** | n8n **watches** the mailbox and polls for new messages | Gmail / Outlook / IMAP trigger | Native. The mailbox stays the mailbox; n8n just reads it. |
| **web form** | n8n **is** the destination — the form posts straight to it | Webhook trigger | Native. Point the form's action at the webhook URL. |
| **voicemail** | phone system records → a transcription service turns it to text → that posts to n8n | Webhook trigger, two services in front | n8n never touches the call. It receives the transcript. |
| **LinkedIn** | a third-party bridge reads the LinkedIn inbox and posts to n8n | Webhook trigger + paid bridge | **The awkward one — see below.** |

### LinkedIn has no native trigger

Three of those four are native n8n nodes. LinkedIn isn't: **there is no
first-party trigger for receiving LinkedIn messages**, in n8n or anywhere else.
LinkedIn's official API doesn't expose the messaging inbox to third parties, so
any tool that reads it is doing so through an unofficial route.

The realistic options:

| option | what it is | cost | notes |
|---|---|---|---|
| **Unipile** | Messaging API covering LinkedIn, email and calendar. Reads and sends from the user's real account. | ~€5 per connected account/month, €49/month minimum | Has first-class n8n documentation and webhook setup guides — the least friction of the three. |
| **HeyReach** | LinkedIn outreach platform with an API, webhooks and inbox/reply handling on every paid tier | subscription, higher than Unipile | Heavier than needed if all you want is inbound. |
| **Manual forward** | someone pastes the message into the web form or forwards it to the triage mailbox | free | Zero integration risk. Fine at Northwind's volume — one LinkedIn message in thirteen. |

**Recommendation: start with the manual forward**, and pay for a bridge once
LinkedIn volume justifies it. One message in thirteen doesn't.

Two constraints come with any of the paid options:

- **Account risk.** They automate a platform that doesn't want to be automated,
  and LinkedIn does restrict accounts for it. That's a risk the firm takes on,
  worth a conversation before anyone signs up.
- **Ongoing cost and an external dependency.** The other three channels are
  nodes n8n already ships. If the bridge goes down or changes its terms, that
  channel stops.

### Look it up, don't guess

Before a message reaches the model, n8n matches the sender's email against the
Clients table and attaches their **customer profile** — everything the firm
already knows about the person writing in:

- **contact details** — name, email, whatever the record holds
- **whether they're a client at all, and how long** — `client_since`
- **the advisor who owns them**
- **their previous messages**, pulled from the Messages table

**A sender the firm has never heard from isn't a dead end.** No match means this
is a new customer contact, so n8n creates the profile from the message itself
and carries on. Nothing is dropped and nothing waits for someone to add them by
hand — the second time they write, there's a history to attach, and the table
fills itself as the queue runs.

**`inb-009` is the case for this.** Sam Cho writes "just following up on our
conversation" and nothing else — no company, no subject, nothing saying what the
conversation was. On the message alone that's `needs_human`, because guessing a
category would route a possible client to the wrong queue. With the lookup his
previous thread arrives attached, and there's nothing left to guess. Most of
what lands in `needs_human` is missing context rather than genuine ambiguity,
and this is where that context comes from.

**What the lookup must not do is move the priority.** Tenure and account size
make the temptation obvious — a ten-year client with $40M feels like he should
jump the queue. The test doesn't change: what breaks if this waits? Enrichment
tells you who is writing and what they've already said. It doesn't tell you what
breaks.

Then everything converges:

```
  email        web form        voicemail        LinkedIn
 (watched)    (posts in)    (transcribed in)   (bridged in)
     │            │                │                │
     └────────────┴────────┬───────┴────────────────┘
                           ↓
                     NORMALISE
        map every source into one shape, seven fields:
        id · received_at · channel · from_name ·
        from_org · subject · body
                           ↓
                       FILTER
            is it BROKEN or BLANK?
            ├─ yes → park in "couldn't read", never call the model
            └─ no  ↓
                       ENRICH
     match from_email against the Clients table
            ├─ known → attach the customer profile:
            │          contact details, tenure, owning
            │          advisor, previous messages
            └─ new   → create the profile from this
                       message, then carry on
                           ↓
                       TRIAGE
            POST to the triage endpoint, enrichment included
                           ↓
            → write the result to the Messages table
            → if priority is high, notify the advisor
              who owns that client
```

**Many front doors, one triage.** Normalising is what makes that true:
everything downstream reads the same seven fields, so the filter and the model
never learn where a message came from. Adding a fifth channel — SMS, WhatsApp, a
partner portal — means adding a trigger and a mapping. Nothing after that
changes.

`data/inbound.json` **is** that normalised shape already, so the tool handles
four channels today with no channel-specific code. The per-channel work lives
entirely in n8n's adapters.

**But `channel` is carried through, not flattened away**, because it stays
useful after normalising:

- **It changes the action.** You call a voicemail back. You answer a LinkedIn
  message on LinkedIn. A web form is inbound-only, so the reply goes to the
  address the form captured. The model is given the channel and told to make
  `next_action` fit it.
- **It explains missing fields.** Voicemails have no subject line. Most web
  forms don't either. That's the whole reason the filter reads the body and
  nothing else — see below.
- **It tells you how to read the text.** A voicemail transcript is spoken
  language: false starts, no greeting, "yeah, hi, this is Bob." Untidy prose
  from a voicemail isn't a low-effort message, it's just speech.

**Trigger on arrival, never on a schedule.** If the batch runs at 8am and an
angry client calls at 9am, nobody sees it until the next morning — the one
time-critical message is the one a batch is slowest on. Firing per-message fixes
that without needing more capacity: 10,000/day is ~7 messages a minute, and the
tool already does ~80.

**Only `high` notifies a person.** If everything pushes, nothing is a signal.

## The pre-flight filter

**One rule:** *if the message is broken or blank, park it; otherwise triage it.*

- **broken** — it contains characters a person can't type (control codes, or the
  `�` left when text is decoded with the wrong encoding). It arrived damaged.
- **blank** — it contains no letters or numbers at all. There's nothing in it.

Those are two different failures, so no single test catches both: a
letters-only check misses `inb-011`, which is full of letters and still
garbage, and a corruption-only check misses `inb-010`, because a period is a
perfectly valid character.

**The code already exists** — `lib/signal.ts` — and in production it doesn't
need porting, because it's two conditions an n8n **IF node** does natively:

| | condition | catches |
|---|---|---|
| **broken** | `body` **matches regex** `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]` | `inb-011` — control codes, and the replacement character left when text decodes wrong |
| **blank** | `body` **does not match regex** `[a-zA-Z0-9]` | `inb-010` — a single period, so not one letter or number in it |

Combine on **ANY**, send the true branch to "couldn't read" and the false
branch to triage. One node, two dropdown conditions, no expressions and no Code
node.

**Use IF, not Filter.** Filter discards what doesn't match. IF gives you both
branches, so rejected messages get parked somewhere countable. If mail starts
arriving broken you want to watch that rate climb, not have it vanish — the
same reason both rows still render in the UI instead of disappearing.

**Blank has no minimum length.** A client replying "ok" is two characters, and a
real client's message silently never reaching a person is the worst thing this
system can do. So blank means *no letters or numbers at all*, with nothing to
tune. `scripts/verify-signal.mts` asserts it: `"ok"`, `"a"` and `"call me"` all
get through; `"."`, `"..."` and `"?!"` are all parked.

**This isn't AI, and shouldn't be.** You don't need a language model to notice a
message is empty. A regex is instant, costs nothing, and gives the same answer
every time.

## How I used AI

I used it the whole way through. Claude Code to build it, Claude for the triage
itself. What I spent my own time on was the decisions: what the categories
should be, what priority actually means, what to do when the model breaks the
rules, and the answer key, which I wrote by hand before the model ran.

**Money isn't urgency.** Left to itself the AI treated the biggest opportunity
in the queue as the most urgent thing in it — `inb-001` is an $8M prospect, so
it wanted him at the top. But nothing breaks if Gregory waits until Thursday. He
set no deadline and the firm isn't late on anything. Sorting by deal size would
have buried the existing client who's angry about a fee and wants a callback
today, which is the one message that actually costs the firm something if it
sits. So priority became one question — what breaks if this waits? — and the
money goes in the summary, where a reader can see it without it moving anything.

**The queue isn't all email.** At one point every message in it was being
handled as an email, which reads fine until you get to `inb-005`: no subject
line, and the most urgent message in the inbox. The reason he has no subject
isn't that he was in a hurry — it's a voicemail transcript, and voicemails don't
have subject lines. Most web forms don't either. Anything keyed on a missing
subject would drop every voicemail this firm ever receives, structurally,
forever. That's why the filter reads the body and nothing else, why `channel` is
carried all the way through instead of being flattened away, and why
`next_action` has to fit the channel it arrived on — you call a voicemail back,
you don't reply to it.

## Notes

- `.env.example` is committed; `.env.local` is gitignored and holds the key.
- `prompts/` has the system prompt and notes on how structured output is
  enforced.
- The prompt is a hand-written template whose category and priority sections are
  generated from `lib/schema.ts`, so the model's rulebook can't disagree with the
  validation about what a valid category is.
