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

## Priority — time pressure ONLY

Priority answers exactly one question: what does a human need to touch first today.

${renderDefinitions(PRIORITY_DEFINITIONS as Record<Priority, string>)}

Do NOT raise priority because a message represents a large amount of money. A $10M prospect who set no deadline is medium priority and high value_signal. Size of opportunity belongs in value_signal, never in priority. This separation is deliberate — an operator sorting by priority is asking "what is time-critical", not "what is lucrative".

## value_signal

Potential business value to the firm, independent of urgency. Use "none" for spam, recruiters, and anything with nothing to win.

## Worked examples

These are illustrations of the priority/value split, not messages in your queue.

Example A — "We're a $15M family foundation reviewing our advisor relationships this year. Interested in learning about your services."
  priority: medium  (no deadline stated — "this year" is not time pressure)
  value_signal: high  ($15M mandate)
  The large sum does not touch priority.

Example B — "Existing client here, I need the beneficiary form signed and back to me by tomorrow morning for the closing."
  priority: high  (hard deadline inside 24h)
  value_signal: low  (administrative, no new revenue)
  Small, unglamorous, and the most time-critical thing in the queue.

Example C — "Following up on my last email about your open roles — are you hiring?"
  priority: low  (unsolicited outreach; the sender's interest creates no urgency for us)
  value_signal: none

## Honesty rules

- If the message has valid fields but you cannot determine intent, use category "unclear" and set confidence below ${CONFIDENCE_FLOOR}. Do not guess a category to appear decisive. A wrong confident label costs more than an honest "unclear" — it routes a real client to the wrong queue.
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
