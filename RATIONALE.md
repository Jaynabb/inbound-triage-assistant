# Engineering Rationale

## a. Data & taxonomy

The brief suggested four categories. I added three, because three messages
didn't fit.

A recruiter isn't spam. They're not selling anything and they're not buying
anything, so they don't belong with a vendor or a newsletter either.

A partnership isn't a vendor. Vendor means money going out. A partnership is
the opposite, money coming in. If you file `inb-007` under vendor you're
telling whoever reads the queue the opposite of what's true.

I added `unclear` because of Sam Cho (`inb-009`). That email could easily be a
real follow up about something he already talked to the firm about. Rather than
guess, I'd rather send it to a human and let them connect the dots.

Priority is based on how fast the firm needs to respond to keep a relationship
smooth and keep customers happy. Not how fast someone wants a response from the
firm. Those two are different more often than you'd think. The vendor in
`inb-003` would love a fast reply and gets low, because nothing happens to the
firm if he waits. Bob Ellison in `inb-005` is angry about a fee and wants a call
today, and that relationship gets worse by the hour, so he's high.

Business value is a separate field. That's why `inb-001` — $8M, no deadline —
is medium priority and high value. If they were one number, "high" would mean
two different things and you couldn't answer why something is medium.

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

_[to write]_

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

It made the same mistake on `inb-013` — a referral from an existing client, high
value, no deadline, also marked high. Same direction both times. It never pushed
a low value message up.

The fix was adding examples to the prompt showing the difference between value
and urgency. I did not use `inb-001` or `inb-013` as those examples. If the
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

## d. Edge cases

Two of the 13 messages never get sent to the model. `inb-010` is empty except
for a single period. `inb-011` is a broken email — the text is scrambled and
there's nothing readable in it.

I stop those before the API call because sending them would cost money for no
reason. With 13 messages that's nothing. At 10,000 a day it adds up.

The important part is what the filter is allowed to look at. `inb-005` is also
missing things — no subject, no company — but it's the most urgent message in
the inbox. He's an existing client, he's angry about a fee, and he wants a call
back today. He's a customer that's angry, and the last thing on his mind is
adding a subject line. So a filter that throws out messages with missing fields
would end up throwing away the angriest customers.

That's why the filter only looks at the body. Not the subject, not the sender.
A missing subject tells you nothing. An empty body tells you everything.

The gap is wide, so the cutoff isn't a guess. The two junk messages have 0
readable characters. The quietest real message has 67.
`scripts/verify-signal.mts` checks this.

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

The fix is to stop batching and trigger on arrival instead. n8n watches the
inbox and fires the triage the moment a message lands, instead of a clock firing
it once a day. Then Bob is flagged high within seconds of writing in.

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

The second risk is alerting. If the model is wrong about priority and it pings
someone's phone, it cries wolf and people start ignoring it. That's why only
high pushes, and why I'd want priority accuracy tracked over time in production
rather than trusting one number off 11 messages.
