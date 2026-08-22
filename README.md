# Inbound Triage Assistant

Triages a shared-inbox queue with an LLM. Each message gets a one-line summary,
a category, a priority, and a suggested next action.

The queue isn't all email — messages arrive by email, web form, LinkedIn and
transcribed voicemail, and the channel changes what you do about them. How all
four funnel into one triage is [below](#how-messages-get-into-the-triage-n8n).

Built for the Arootah AI Product Engineer take-home.

The reasoning behind the design decisions is in **[RATIONALE.md](RATIONALE.md)**
— that's the part worth reading.

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

**`claude-haiku-4-5-20251001`, `temperature: 0`.** Classification against a tight
schema is what a small fast model is for. Temperature 0 because this is
classification, not writing — re-running the queue shouldn't shuffle the
categories. Override with `TRIAGE_MODEL` if you want to compare against a larger
one; `scripts/eval.mts --model <id>` scores any model against the same answer
key.

**Seven categories, not the four suggested.** `partner`, `recruiter` and
`needs_human` were added because three messages didn't fit. See RATIONALE (a).

**Priority is one question: what breaks if this waits?** Something breaks today
is high, nothing breaks but someone's waiting is medium, nothing breaks and
nobody's waiting is low. The question says nothing about money on purpose — an
$8M prospect with no deadline is medium, because nothing breaks if he waits. The
amount goes in the summary where a reader can see it; it just doesn't move him
up the queue.

**The sender doesn't set the priority, in either direction.** A vendor wanting
a reply this week doesn't make him high, and a prospect opening with "no rush at
all" doesn't make her low — she still asked a question and is waiting on an
answer. The firm sets its service standard, not the person writing in.

**On screen those bands are service standards** — handle today, within 2
business days, within 3 business days. "Can wait" promises nothing; a
commitment is a better thing to show. "Handle" rather than "respond", because
archiving a newsletter is handling it.

**The standards are not in the model's prompt, and that was measured.** With
them in, priority dropped to 10/11 — `inb-013` moved to high, and the model's
reasoning said "nothing breaks today" and marked it high anyway, on the grounds
that a referral deserves attentive service. Framing bands as standards invited
service-quality reasoning instead of breakage reasoning. Moved them to the UI
and it went back to 11/11. **The model gets the test; the operator gets the
commitment.**

**I built a separate value field and removed it.** The brief asks for four
things and value was a fifth I'd added. Once priority was one question, the
second axis was answering something nobody asked, and "high priority, low value"
read as contradictory even though both halves were true.

**Two junk messages are filtered before the API call** — one broken, one blank.
The filter reads the message body only, never the subject or sender: `inb-005`
has no subject and is the most urgent message in the inbox, because it's a
voicemail transcript and voicemails don't have subject lines. See RATIONALE (d).

**An answer key, written by hand before running the model** (`eval/answer-key.json`),
turns "looks about right" into a number. `scripts/eval.mts` scores against it.

## How I'd model this in Airtable

Two tables, linked on the sender's email.

```
Clients                    Messages
─────────────              ──────────────────────────
name                       from_email
email          ◄────────── Client         (linked)
owning_advisor             received_at / channel
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

### LinkedIn needs a paid bridge, and that's a decision not a detail

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

**What I'd actually recommend:** start with the manual forward, and only pay for
a bridge once LinkedIn volume justifies it. One message in thirteen doesn't.

Two things worth saying plainly rather than burying:

- **These tools carry account risk.** They automate a platform that doesn't want
  to be automated, and LinkedIn does restrict accounts for it. That's a risk the
  firm takes on, not a technical detail — worth a conversation before anyone
  signs up.
- **It's the one channel with an ongoing cost and an external dependency.** The
  other three are nodes n8n already ships. If the bridge goes down or changes
  its terms, that channel stops.

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
                       TRIAGE
            POST to the triage endpoint
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

`data/inbound.json` **is** that normalised shape already, which is why the tool
handles four channels today without a single line of channel-specific code. The
per-channel work lives entirely in n8n's adapters.

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

I've deliberately not named the notification channel. Arootah's stack mentions
Airtable, n8n/Zapier and a CRM, and I don't know what they use for alerts — so
that's a question, not an assumption.

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

**"Blank" has no minimum length, deliberately.** An earlier version required 15
characters. It looked reasonable and it was wrong — a client replying "ok" is
two characters, and a real client's message silently never reaching a person is
the worst thing this system can do. So blank means *no letters or numbers at
all*, with nothing to tune. `scripts/verify-signal.mts` asserts it: `"ok"`,
`"a"` and `"call me"` all get through; `"."`, `"..."` and `"?!"` are all parked.

**And this deliberately isn't AI.** You shouldn't need a language model to
notice a message is empty. A regex is instant, costs nothing, and can't have a
bad day. Using an LLM here would be slower, more expensive per message, and
less reliable than the thing it replaced.

**Known limitation:** an emoji-only reply — a client sending just 👍 — has no
letters or numbers and gets parked. It's in the "couldn't read" branch rather
than deleted, so it's recoverable, and there's nothing in it to triage anyway.

## How I used AI

I used it the whole way through. Claude Code to build it, Claude for the triage
itself. What I spent my own time on was the decisions: what the categories
should be, what priority actually means, what to do when the model breaks the
rules, and building the answer key by hand before I let the model near it.

**Where I overrode it.** While I was working out the n8n automation, it wrote
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
explanation could cut out important context. It couldn't defend the limit, so I
dropped it. That's written up in RATIONALE (b).)_

## Notes

- `.env.example` is committed; `.env.local` is gitignored and holds the key.
- `prompts/` has the system prompt and notes on how structured output is
  enforced.
- The prompt is a hand-written template whose category and priority sections are
  generated from `lib/schema.ts`, so the model's rulebook can't disagree with the
  validation about what a valid category is.
