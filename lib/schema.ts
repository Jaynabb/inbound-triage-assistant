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
 * Priority answers one question: WHAT BREAKS IF THIS WAITS?
 *
 * Not how big the opportunity is, and not how badly the sender wants a reply.
 * Just: if nobody touches this today, does something go wrong?
 *
 * The question deliberately says nothing about money. `inb-001` is an $8M
 * liquidity event with no deadline — nothing breaks if he waits until
 * Thursday, so it's `medium`. The size of the opportunity is real and it's
 * already in the summary; it just has no bearing on what gets handled first.
 *
 * It settles the case people get wrong in the other direction too: a vendor
 * would love a fast reply, but nothing breaks if he never gets one. Low.
 */
export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_DEFINITIONS: Record<Priority, string> = {
  high: "Something breaks if this waits — a deadline passes, a complaint escalates, or a client relationship degrades.",
  medium:
    "Nothing breaks today, but someone is waiting on us for a real answer.",
  low:
    "Nothing breaks and nobody is waiting on us. Includes unsolicited sales, recruiting and outreach — the sender wanting a reply is not the firm having something at stake.",
};

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
    .describe(
      "Justification for the category and priority. Shown in the UI for auditability.",
    ),
  // Deliberately NOT length-capped. This is the audit trail — it's what a
  // person reads to check whether a triage was sound, and the qualifier tends
  // to live at the end ("...but he may be an existing client, worth checking").
  // Truncating it makes the record misleading, which is worse than not having
  // one. The UI already collapses it behind a toggle, so length costs nothing
  // on screen, and max_tokens bounds it against a runaway response.
  //
  // An earlier version capped this at 300 chars. The model consistently wanted
  // 320-370, so the cap fought it on 3 of 11 messages for no benefit. The cap
  // was mine and the UI never needed it.
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
   * Set when the first attempt failed validation on a ROUTING field and the
   * corrective retry succeeded. Costs a second API call, so this is the
   * expensive repair and is tracked separately from truncation below.
   */
  repaired_from?: string | null;

  /**
   * Cosmetic fields trimmed to their limits (display-only, costs nothing).
   * Deliberately NOT merged with repaired_from: the point of tiering the
   * validation was to convert expensive retries into free truncations, and a
   * single combined counter would hide exactly that.
   */
  truncations?: string[];
}
