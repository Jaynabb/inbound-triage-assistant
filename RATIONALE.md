# Engineering Rationale

## a. Data & taxonomy

The brief suggested four categories — prospect, existing client, vendor, spam.
I added three, because three messages didn't fit, so there are seven:
`prospect`, `existing_client`, `vendor`, `partner`, `recruiter`, `spam`,
`needs_human`.

A recruiter isn't spam. They're not selling anything and they're not buying
anything, so they don't belong with a vendor or a newsletter either.

A partnership isn't a vendor. Vendor means money going out. A partnership is
the opposite, money coming in. If you file `inb-007` under vendor you're
telling whoever reads the queue the opposite of what's true.

I added `needs_human` because of Sam Cho (`inb-009`). That email could easily be
a real follow up about something he already talked to the firm about. Rather
than guess, I'd rather send it to a human and let them connect the dots.

I called it `unclear` at first and renamed it. The row was showing "needs a
human" and "unclear" next to each other — two labels for one thing — and naming
the category for what to *do* is more useful than naming it for how the message
reads.

Priority comes down to one question: **what breaks if this waits?**

- Something breaks today — high
- Nothing breaks, but someone's waiting on us — medium
- Nothing breaks and nobody's waiting — low

That's the whole rule. Dana in `inb-002` is high because her mortgage lender
needs the statement by Friday and she misses her deadline if we sit on it. Bob
in `inb-005` is high because he's already angry and gets angrier by the hour.
Marcus in `inb-003` would love a reply next week, but nothing breaks for the
firm if he never gets one, so he's low.

**The sender doesn't set the priority, in either direction.** Marcus wanting a
reply this week doesn't make him high. And Alicia in `inb-006` opening with "no
rush at all" doesn't make her low — she still asked what the minimum is and how
fees work, so she's waiting on an answer. A prospect telling us not to rush
doesn't get to dictate how we treat prospects; the firm sets that standard, not
the person writing in.

I had her at low at first, on the grounds that she'd said so herself. That was
wrong, and fixing it made the bands coherent for the first time: everything in
the 2-day band is now someone waiting for an answer, and everything in the
3-day band is unsolicited outreach with nobody at the firm waiting. Before the
change, a real prospect was filed alongside a vendor pitch and a newsletter.

Some history on how the rule got to one sentence. I started with a three-part
definition — a deadline inside 72 hours, or an escalation, or an at-risk
relationship. It gave the right answers and took three clauses to say. When I
swapped it for "what breaks if this waits" I re-ran the eval and every message
landed in the same band, so it was a restatement rather than a redesign.
(Alicia moved later, and for a different reason — the sender rule above, not
this one.)

**On screen the bands are service standards, not moods.** Handle today, within
2 business days, within 3 business days. "Can wait" describes a feeling and
promises nothing, which made the biggest opportunity in the queue look like it
was being shrugged at. A commitment is a better thing to show. The word is
"handle" rather than "respond" because the bottom band holds both a real
prospect who deserves an answer and a newsletter that needs no reply ever —
archiving is handling, so one verb covers the band without special cases.

**And the standards are deliberately not in the model's rulebook.** I put them
there first and the eval caught it: priority dropped from 11/11 to 10/11, with
`inb-013` — Nathan, referred by an existing client — moving from medium to
high. The model's own reasoning showed exactly what went wrong:

> "Referrals from existing clients are high-priority because they represent
> trusted relationships... **nothing breaks today**, but the prospect is
> actively ready to engage and Dana's credibility is on the line if we delay."

It applied my test, got the right answer, and then talked itself out of it.
Framing the bands as service standards invited it to reason about how attentive
to be instead of about what breaks, and the value-into-urgency problem came
back in through that door. Moving the standards to the UI put it back to 11/11.

So the model gets the test and the operator gets the commitment. The test
decides which band a message lands in; the commitment is what that band
promises once it's there. Two different audiences needing two different things,
and I only found that out because the eval was there to tell me.

Notice the question says nothing about money, and that's the point. `inb-001` is
$8M with no deadline — nothing breaks if Gregory waits until Thursday, so he's
medium. The money is real and it's right there in his summary, it just has no
bearing on what gets handled first.

I did try carrying a separate `value_signal` field alongside priority, and I
took it out. It worked, but the brief asks for four things — a summary, a
category, a priority, a next action — and value was a fifth I'd added. Once
priority was stated as one question, the second field was answering a question
nobody asked, and rows reading "high priority, low value" looked contradictory
at a glance even though both halves were true. One axis, one rule, nothing to
reconcile.

On adding more categories: everything is defined in one spot in the TypeScript
(`lib/schema.ts`). If you want to add a category, say `press` because someone
wants to write an article about the firm, you add it there. But it won't build
until you also write the description of what press means and what kind of
messages go in it. So it serves as its own check and balance, and everything
stays in one place for the system to pick up.

I actually did this while building. I added `press`, got a build error for the
missing description, wrote it, and then press showed up in the validation, the
schema sent to the API, the model's instructions, and the UI legend without me
touching any of those files. I took it back out after, because nothing in this
queue is a press message and I didn't need the extra category.

## b. Reliable structure

Instead of asking the model a question and hoping the answer comes back tidy, I
hand it a form with six boxes and make it fill them in. That's tool use
(`lib/triage.ts`, `tool_choice`). The API makes sure every field is there, the
types are right, and the category is always one of my seven. It can't write me
a paragraph instead.

But the form only guarantees the boxes get filled. It doesn't guarantee what's
in them follows the rules. A summary that's supposed to be one line can come
back as four and still be perfectly valid JSON. So I don't depend on the form
alone — a second layer checks the answer against what it should have been
(`TriageResultSchema` in `lib/schema.ts`), and that makes the whole thing more
dependable.

When the check fails, what happens depends on which box was wrong.

`summary` and `next_action` are one-line fields shown inline on every row. If
one runs long I trim it and move on. I'm not making anything up — the words are
still the model's, I just cut the end off. No extra call needed.

The category box is different. That decides where the message goes and who sees
it. If the model puts something invalid there, I don't pick one myself, because
that's guessing and passing it off as a real answer. A bad guess from me does
the same damage as a bad guess from the model, except now nothing looks broken
so nobody checks. Instead it goes back to the model with the specific problem
and gets re-analyzed. If it fails again the message is marked as an error and
shows on screen, instead of the app pretending it worked.

**The rule is: if a field only gets read, fix it quietly. If a field decides
where something goes, never guess.**

**One thing I changed my mind about.** I originally capped `reasoning` at 300
characters too, and treated it as another trim-if-long field. The model
consistently wanted 320–370, so the cap tripped on 3 of 11 messages and every
one of those was otherwise correct. When I looked at why I'd set the limit, the
reason didn't hold up: `reasoning` is the audit trail, it's what a person reads
to check whether a triage was sound, and the UI already collapses it behind a
toggle so length costs nothing on screen. Worse, trimming an explanation cuts
the end, and the qualifier tends to live at the end. That makes the record
misleading, which is worse than long. So I removed the cap. It was my
constraint, not a real one, and the model was right to fight it.

**One bug I only found by running it.** The first version of the retry sent a
plain text message back to the model. The API rejects that — after a tool call
the reply has to come back in a specific format (a `tool_result` block). So the
retry was broken on exactly the messages that needed it, which is the worst
place for a bug to hide. Reading the code wouldn't have caught it.

## c. Where the model was wrong

The model got `inb-001` wrong. Gregory Palmer just sold his business and has
$8M to invest, and he asks who he should speak with. He never says when he
needs an answer. There's no sense of urgency about response time. The model
marked it high priority anyway, and what it was reacting to was the $8 million.
The prompt told it not to do that.

I caught it because I built my own rules for urgency first and went through all
13 messages by hand before I ran the model (`eval/answer-key.json`). That way my
logic is the benchmark and the model gets graded against it, instead of the
other way around. Doing it in that order also means I can't be talked into
agreeing with the model after I see its answers.

It made the same mistake on `inb-013` — Nathan, referred by an existing client,
no deadline, also marked high. Same direction both times: the two messages
carrying the most money were the two it pushed up. It never made the reverse
error, so this was a consistent bias rather than a random miss. The model was
treating "worth a lot" and "urgent" as the same axis.

The fix was adding examples to the prompt showing that a large sum doesn't touch
priority. I did not use `inb-001` or `inb-013` as those examples. If the
failing message is in the prompt, the answer is just part of the prompt rather
than something the model had to figure out. Calculation versus regurgitation.
Using made up examples meant that when it got `inb-001` right after, it was
working it out on something it hadn't been shown.

Priority went from 9/11 to 11/11 (`scripts/eval.mts`).

That said, 11 messages is too small a sample to trust. Going from 9 right to 11
right is two messages. It tells me the fix works on the problem I found. It
doesn't tell me the system is right. Before I relied on it I'd want a few
hundred labeled messages, and I'd track priority accuracy over time instead of
quoting one number.

**And the score isn't perfectly stable between runs.** I ran the eval five times
back to back near the end: four came back 24/24 and one came back 23/24. Same
prompt, same messages, `temperature: 0`. Temperature 0 makes a model much more
consistent but it doesn't make it deterministic, so a single score is a sample
too — not a fixed property of the system. That's another reason a number off 11
messages shouldn't be leaned on, and another argument for tracking accuracy as a
running metric in production rather than quoting a run.

## d. Edge cases

The filter is one rule: **if a message is broken or blank, park it. Otherwise
triage it.**

- **Broken** means it has characters a person can't type — control codes, or
  the `�` you get when text is decoded wrong. It arrived damaged. That's
  `inb-011`.
- **Blank** means it has no letters or numbers in it at all. That's `inb-010`,
  which is a single period.

They're two different failures, so one test can't catch both. `inb-011` is full
of letters and still garbage, so a letters check misses it. `inb-010` is a
period, and a period is a perfectly valid character, so a corruption check
misses it.

I stop those two before the API call because sending them would cost money for
no reason. With 13 messages that's nothing. At 10,000 a day it adds up.

The important part is what the filter is allowed to look at, and the case that
settles it is `inb-005`.

He has no subject line and he's the most urgent message in the inbox — an
existing client, angry about a fee, asking for a callback today. But the reason
he has no subject isn't that he was in a hurry. **It's a voicemail transcript,
and voicemails don't have subject lines.** Neither do most web forms —
`inb-010` is a web-form submission and it has no subject either.

So a filter keyed on missing fields wouldn't just drop one unlucky message. It
would drop **every voicemail this firm ever receives**, structurally, forever —
including the client who was angry enough to pick up the phone instead of
writing. The queue isn't all email: 8 of these 13 are, and the rest come in by
web form, LinkedIn and voicemail.

That's why the filter only looks at the body. Not the subject, not the sender.
A missing subject tells you which channel it came from. An empty body tells you
there's nothing to read.

The channel earns its place downstream too: `next_action` has to fit it. You
answer a voicemail by calling the person back, not by replying to it. You answer
a LinkedIn message on LinkedIn. A web form is inbound only — you can't reply
through a contact form, but the form captured their details, so the response
goes by email or phone. The model gets the channel and is told to use it: Bob's
action reads "call Bob back", Priya's reads "reply on LinkedIn", and Jordan's
reads "email Jordan at the address provided".

My first attempt at that instruction said a web form "has no reply address, so
say where the response should go", and the model duly suggested replying *via
the web form* — which isn't a thing. The instruction was wrong, not the model.

I stopped there deliberately. The obvious next step is buttons — reply, respond,
schedule a callback — and that turns a triage board into a mail client: sending
mail, a calendar integration, knowing who's logged in, handling a send that
fails. Auth, integrations and multi-user are all explicitly out of scope in the
brief. The tool's job is to say what to do next; in production the n8n workflow
is what would do it.

There's no minimum length, and that was a bug I caught late. I originally had
"blank" mean fewer than 15 characters, which sounds reasonable until you notice
that a client replying **"ok"** is two characters. That message would have been
parked and nobody would ever have known — which is the worst thing this system
can do.

So blank means no letters or numbers at all. There's no number to tune and no
threshold to defend. `scripts/verify-signal.mts` asserts it both ways: `"ok"`,
`"a"` and `"call me"` get through; `"."`, `"..."` and `"?!"` are parked.

One limitation worth naming: an emoji-only reply — a client sending just 👍 —
counts as blank and gets parked. It's still visible in the couldn't-read
branch rather than deleted, and there's nothing in it to triage anyway.

The skipped messages still show up on screen with the reason. Nothing
disappears.

I also kept "skipped" and "error" as two separate statuses instead of one.
That's to tell the difference between internal system errors and bad data
coming from the customer side. Knowing which one you're looking at tells you how
to fix it. Junk coming in is normal and you do nothing. Errors mean something on
our end is broken.

## e. Scale & risk

Right now it's one API call per message. 13 messages takes about 10 seconds, so
10,000 would take around 2 hours.

But that 2 hours isn't really the problem. 10,000 a day is about 7 messages a
minute, and the tool can already do about 80 a minute at 4 at a time. There's
plenty of capacity. The problem is running it as a batch.

If the tool runs at 8am and Bob sends his angry message at 9am, nobody sees it
until the next morning. The one message that was actually time sensitive is the
one the system is slowest on. That's backwards.

The fix is to stop batching and trigger on arrival instead, so a clock never
decides when anything gets looked at. Then Bob is flagged within seconds of
calling in.

That means several triggers, not one, because the queue isn't all email. Of
these 13, eight are email, three are web-form submissions, one is LinkedIn and
one is a transcribed voicemail. n8n *watches* a mailbox, but it *receives* a web
form — the form posts straight to a webhook. Voicemail is two hops: the phone
system records it, a transcription service turns it into text, and that posts to
n8n. LinkedIn is the awkward one, with no first-party trigger at all; it needs a
third-party bridge or someone forwarding manually, and I'd flag that as a
decision rather than pretend it's solved.

What makes it one system instead of four is normalising every source into the
same shape before anything downstream sees it — id, received_at, channel,
from_name, from_org, subject, body. The filter and the model never learn where a
message came from. `data/inbound.json` is already that shape, which is why the
tool handles four channels today without a line of channel-specific code.

Only high priority gets pushed out to a person. If everything pushes, nothing is
a signal and people start ignoring it.

If volume ever got past what the tool can handle, that's when I'd add a cheap
first pass to rank messages before the full triage. At this size it isn't
needed, and I'd rather not build it until it is.

**The biggest risk is the model marking a real client as spam.** They never get
a response and the firm loses them. That's the worst failure because it's
silent. If it wrongly calls a vendor a client, someone notices — there's a
client in the queue who isn't one. If it calls a client spam, nobody ever finds
out. Errors you can see are cheap. Errors you can't see aren't.

The fix is to stop asking the model to guess something the firm already knows.
Right now it decides `existing_client` by reading the text — Bob says he's a
client, so it believes him. But the firm has a list of its clients. Match the
sender's email against that list and it's a fact, not a guess. Use the model for
judgment — intent, urgency, tone. Use the database for facts.

The same thing applies to `inb-009`. Sam Cho says "just following up on our
conversation" and nothing else, and the model correctly calls it `needs_human`
at 35% confidence, because from that text alone it genuinely can't be known. But
that isn't the model failing. The information isn't missing from the world, it's
missing from the message. Once n8n is triggering this on arrival it can attach
the previous thread, and there's nothing left to guess about.

Both of those are the same principle: don't ask the model to work out something
the firm could have looked up before asking. Look up the facts first, then let
the model judge the part that actually needs judgment.

The second risk is alerting. If the model is wrong about priority and it pings
someone's phone, it cries wolf and people start ignoring it. That's why only
high pushes, and why I'd want priority accuracy tracked over time in production
rather than trusting one number off 11 messages.
