# Engineering Rationale

## a. Data & taxonomy

The brief suggested four categories. I added three, because three messages in
the sample didn't fit without losing something real.

A recruiter doesn't belong in spam — they're neither buying nor selling, so
they don't sit alongside a vendor or a newsletter either. A partnership inquiry
doesn't belong in vendor: vendor means revenue going out, and a partnership is
the opposite, revenue coming in. Filing `inb-007` under vendor would tell
whoever reads the queue the opposite of the truth.

I added `unclear` because of Sam Cho (`inb-009`). That email could easily be a
legitimate follow-up about something he'd already discussed with the firm.
Rather than guess, I'd rather route it to a human and let them connect the
dots. `unclear` is a routing destination, not a failure.

**Priority is based on how fast the firm needs to respond — to keep a
relationship smooth and keep customers happy — rather than how fast someone
wants a response from the firm.** Those come apart more often than you'd
expect. The vendor in `inb-003` would love a reply next week and gets `low`,
because nothing happens to the firm if he waits. Bob Ellison in `inb-005` is
disputing a fee and wants a callback today, and that relationship degrades by
the hour, so it's `high`.

Business value is a separate field (`value_signal`) rather than being folded
into priority. That's why `inb-001` — $8M from a liquidity event, no deadline —
is `priority: medium` with `value_signal: high`. If the two were one number,
"high" would mean two different things and "why is this medium" would have no
answer.

**On extending it:** everything is defined in one spot in the TypeScript
(`lib/schema.ts`). If you want to add a category — say `press`, because someone
wants to write an article about the firm — you add it there, but it won't build
until you also write the description of what `press` means and what kind of
messages belong in it. So it serves as its own check and balance, while keeping
everything centralized in one place for the system to pick up on.

I actually did this while building: added `press`, got a compile error for the
missing definition, wrote it, and the category then appeared in the validation
enum, the tool schema sent to the API, the model's instructions, and the UI
legend without my touching any of those files. I removed it again afterwards,
because nothing in this queue is a press inquiry and shipping an unused
category is scope I didn't need.

## b. Reliable structure

_[to write]_

## c. Where the model was wrong

_[to write]_

## d. Edge cases

_[to write]_

## e. Scale & risk

_[to write]_
