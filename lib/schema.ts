import { z } from "zod";

/**
 * Taxonomy.
 *
 * The brief suggested prospect / existing client / vendor / spam. I extended it
 * because three messages in the sample don't fit that shape without losing real
 * signal:
 *
 *   - inb-007 is another RIA proposing a referral partnership. That's revenue
 *     coming IN. Filing it under "vendor" (revenue going out) inverts its
 *     meaning to whoever reads the queue.
 *   - inb-004 is a recruiter. Sells nothing, buys nothing. It's noise to the
 *     business but it isn't spam, and a firm may want to route it to a person
 *     rather than delete it.
 *   - inb-009 has valid fields and is still unclassifiable ("just following up
 *     on our conversation", org "(unknown)"). Forcing it into a bucket would
 *     manufacture a confidence the message doesn't support.
 *
 * `unclear` is deliberately a routing destination, not a failure. See
 * CONFIDENCE_FLOOR below for the guard against it becoming a dumping ground.
 */
export const CATEGORIES = [
  "prospect",
  "existing_client",
  "vendor",
  "partner",
  "recruiter",
  "spam",
  "unclear",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Human-readable definitions. Sent to the model AND rendered in the UI, so the
 *  operator and the model are working from the same rulebook. */
export const CATEGORY_DEFINITIONS: Record<Category, string> = {
  prospect: "Someone who could become a client. Not currently a client.",
  existing_client: "Self-identifies as, or is clearly, a current client.",
  vendor: "Selling something to the firm. Revenue going out.",
  partner: "Proposing a two-way business relationship — referrals, co-advisory. Revenue coming in.",
  recruiter: "Recruiting for a role. Neither buying nor selling a service.",
  spam: "Automated, bulk, or no-intent. Newsletters, blasts, unsubscribe footers.",
  unclear: "Fields are valid but intent cannot be determined without more context. Routes to a human.",
};

/**
 * Priority = TIME PRESSURE ONLY.
 *
 * The deliberate choice here is that priority answers exactly one question:
 * what does a human need to touch first today. Business value is a separate
 * field (`value_signal`) so a large opportunity is surfaced rather than
 * smuggled into an urgency number.
 *
 * Concretely: inb-001 is an $8M liquidity event with no deadline. It is
 * `priority: medium` and `value_signal: high`. A blended score would have
 * called it "high" and made "high" mean two different things.
 */
export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_DEFINITIONS: Record<Priority, string> = {
  high: "A stated deadline inside ~72h, an escalation/complaint, or an at-risk client relationship.",
  medium:
    "Someone with a legitimate claim on the firm's time wants a real response, but named no deadline. Normal business pace.",
  low:
    "No time pressure, nothing to action, or unsolicited inbound sales/recruiting/outreach. A sender wanting a reply does not by itself create urgency for the firm — a vendor cold pitch is low no matter how keen the vendor is.",
};

/** Business value, kept separate from urgency on purpose. */
export const VALUE_SIGNALS = ["high", "medium", "low", "none"] as const;
export type ValueSignal = (typeof VALUE_SIGNALS)[number];

/**
 * The contract the model must satisfy. This is the single source of truth:
 * it generates the tool schema sent to the API AND validates what comes back,
 * so the two can never drift apart.
 */
export const TriageResultSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(200)
    .describe("One line, under 200 chars, describing what this message wants."),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  value_signal: z
    .enum(VALUE_SIGNALS)
    .describe("Potential business value, independent of urgency. 'none' for spam/noise."),
  next_action: z
    .string()
    .min(1)
    .max(200)
    .describe("The single concrete next step a human should take."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0-1. How certain the category is. Low confidence on a real message means route to a human."),
  reasoning: z
    .string()
    .max(300)
    .describe("Brief justification for the category and priority. Shown in the UI for auditability."),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

/**
 * Guard against `unclear` becoming a dumping ground: if the model returns a
 * confident category we keep it, but if it returns ANY category below this
 * floor we surface it for review rather than trusting the label.
 */
export const CONFIDENCE_FLOOR = 0.6;

/** How a triaged row ends up in the UI, including the ways it can fail. */
export type TriageStatus = "ok" | "review" | "skipped_malformed" | "error";

export interface TriagedItem {
  id: string;
  status: TriageStatus;
  result: TriageResult | null;
  /** Populated for skipped_malformed and error. */
  note: string | null;
  /** Milliseconds for the model call. Null when we never called. */
  latency_ms: number | null;
  /**
   * Set when the first attempt failed zod validation and the corrective retry
   * succeeded. Carries the original validation error, so the repair rate and
   * the specific failure modes are observable rather than silently swallowed.
   */
  repaired_from?: string | null;
}
