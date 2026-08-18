/**
 * Pre-flight signal check — runs BEFORE any model call.
 *
 * Design rule, and the most important line in this file:
 *
 *   This function only ever looks at the BODY. It never inspects subject,
 *   from_name, or from_org.
 *
 * Why: inb-005 in the sample has no subject at all and is the single most
 * urgent message in the inbox (existing client, disputed fee, "someone needs
 * to call me back today"). inb-008 has no from_name and is a newsletter. A
 * filter keyed on "missing fields" would drop the most important message and
 * keep the least. Missing metadata is normal; an empty body is not.
 *
 * Two jobs:
 *   1. Don't spend an API call on content-free input (the 10k/day cost story).
 *   2. Give the UI an honest reason string instead of a silent drop.
 */

/** Artifacts that are transport noise, not human content. */
const NOISE_PATTERNS: Array<[RegExp, string]> = [
  // Control characters (keep \n and \t — they're real formatting).
  [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""],
  // Unicode replacement char — the tell for mangled encoding.
  [/�/g, ""],
  // MIME headers and multipart boundaries.
  [/Content-Type:\s*\S+/gi, ""],
  [/boundary=\S+/gi, ""],
  [/Content-Transfer-Encoding:\s*\S+/gi, ""],
  // RFC 2047 encoded-word fragments (e.g. "=?utf-8?B?").
  [/=\?[\w-]+\?[BQ]\?[^?]*\??/gi, ""],
  // Mail-client truncation markers.
  [/-{2,}\s*forwarded message[^-]*-{2,}/gi, ""],
  [/-{2,}\s*(original message|message truncated)[^-]*-{2,}/gi, ""],
];

/**
 * Minimum letters/digits required to be worth a model call.
 *
 * Calibrated against the sample: the shortest legitimate message body is
 * inb-009 at ~90 alphanumeric chars ("just following up..." — vague, but real
 * and correctly routed to `unclear` by the model, not skipped here). The
 * garbage items land at 0. 15 sits in the wide gap between them, so this
 * threshold is not load-bearing — anything from 1 to ~80 produces identical
 * behaviour on this data. Stated explicitly because a magic number that
 * happens to work is a fair thing to be challenged on.
 */
export const MIN_REAL_CHARS = 15;

export interface SignalCheck {
  hasSignal: boolean;
  /** Body with transport noise removed. This is what we send to the model. */
  cleaned: string;
  /** Count of letters/digits surviving the strip. */
  realChars: number;
  /** Human-readable reason when hasSignal is false. */
  reason: string | null;
}

export function checkSignal(rawBody: unknown): SignalCheck {
  if (typeof rawBody !== "string") {
    return {
      hasSignal: false,
      cleaned: "",
      realChars: 0,
      reason: "body missing or not a string",
    };
  }

  let cleaned = rawBody;
  for (const [pattern, replacement] of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Count only letters and digits. Punctuation alone ("." in inb-010) is not
  // content, and neither is a line of dashes.
  const realChars = (cleaned.match(/[\p{L}\p{N}]/gu) ?? []).length;

  if (realChars < MIN_REAL_CHARS) {
    const reason =
      realChars === 0
        ? "no readable content after stripping transport noise"
        : `only ${realChars} readable characters (min ${MIN_REAL_CHARS})`;
    return { hasSignal: false, cleaned, realChars, reason };
  }

  return { hasSignal: true, cleaned, realChars, reason: null };
}
