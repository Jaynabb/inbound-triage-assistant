import {
  CATEGORY_DEFINITIONS,
  PRIORITY_DEFINITIONS,
  CONFIDENCE_FLOOR,
  type Category,
  type Priority,
} from "./schema.ts";

/**
 * The system prompt is BUILT from the schema definitions rather than written
 * out by hand.
 *
 * This is the direct answer to "how would your data model hold up if the
 * taxonomy doubled": you add one entry to CATEGORY_DEFINITIONS in schema.ts
 * and the zod enum, the tool schema sent to the API, the prompt the model
 * reads, and the UI legend all update together. There is no second place to
 * remember. A hand-written prompt is the usual source of this bug — the enum
 * gains a category, the prompt doesn't, and the model never emits it.
 */

function renderDefinitions(defs: Record<string, string>): string {
  return Object.entries(defs)
    .map(([key, description]) => `- ${key}: ${description}`)
    .join("\n");
}

export function buildSystemPrompt(): string {
  return `You triage inbound messages for Northwind Advisors, an alternative-investment and family-office advisory firm. A human reads your output to decide what to handle first. Be decisive and be honest about uncertainty.

## Categories

${renderDefinitions(CATEGORY_DEFINITIONS as Record<Category, string>)}

## Priority — what breaks if this waits?

That is the whole test. Ask it and nothing else. If nobody touches this message today, does something go wrong?

${renderDefinitions(PRIORITY_DEFINITIONS as Record<Priority, string>)}

The question says nothing about money, and that is deliberate. A $10M prospect who set no deadline is medium — nothing breaks if he waits until Thursday. The size of an opportunity never raises the priority. Put the amount in the summary, where it belongs, and leave priority alone.

It cuts the other way too. A vendor may want a reply this week, but nothing breaks for the firm if he never gets one. The sender wanting speed is not the firm having something at stake.

**The sender does not set the priority, in either direction.** Someone writing "urgent!" does not make it high, and someone writing "no rush at all" does not make it low. A prospect who asks a real question is waiting for an answer whether or not they were polite about the timing — the firm decides how it treats its prospects, not the person writing in. Ask only what breaks, and who is waiting on us.

## Worked examples

These illustrate the rule. They are not messages in your queue.

Example A — "We're a $15M family foundation reviewing our advisor relationships this year. Interested in learning about your services."
  priority: medium  (nothing breaks if this waits — "this year" is not a deadline)
  The $15M does not touch priority. Mention it in the summary instead.

Example B — "Existing client here, I need the beneficiary form signed and back to me by tomorrow morning for the closing."
  priority: high  (their closing breaks if this waits)
  Small, unglamorous, no new revenue, and the most urgent thing in the queue.

Example C — "Following up on my last email about your open roles — are you hiring?"
  priority: low  (nothing breaks, and nobody at the firm is waiting on this)

## Honesty rules

- If the message has valid fields but you cannot determine intent, use category "needs_human" and set confidence below ${CONFIDENCE_FLOOR}. Do not guess a category to appear decisive. A wrong confident label costs more than an honest "needs_human" — it routes a real client to the wrong queue.
- from_org values like "(individual)" and "(unknown)" are placeholders, NOT company names. Never treat them as an organisation, and never let "(individual)" push you toward or away from any category.
- An empty subject or a missing sender name is normal and means nothing on its own. Judge intent from the body.
- next_action must be one concrete step a person can take today (e.g. "Send Q3 statement to Dana by Thursday"), not a restatement of the message.
- summary is one line. Do not exceed 200 characters.

Call the triage tool exactly once with your result.`;
}

/** The per-message user turn. Metadata is labelled so the model can weigh it. */
export function buildUserPrompt(item: {
  id: string;
  received_at: string;
  channel: string;
  from_name: string;
  from_org: string;
  subject: string;
  cleanedBody: string;
}): string {
  const field = (label: string, value: string) =>
    `${label}: ${value && value.trim() ? value : "(empty)"}`;

  return [
    field("channel", item.channel),
    field("received_at", item.received_at),
    field("from_name", item.from_name),
    field("from_org", item.from_org),
    field("subject", item.subject),
    "",
    "body:",
    item.cleanedBody,
  ].join("\n");
}
