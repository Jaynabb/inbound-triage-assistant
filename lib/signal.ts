/**
 * The pre-flight check — runs BEFORE any model call.
 *
 * Two questions, in this order:
 *
 *   1. Is the message corrupted?  Does it contain characters a person cannot
 *                                 type — null bytes, control codes, or the "�"
 *                                 left behind when text is decoded with the
 *                                 wrong encoding? Then it arrived broken.
 *
 *   2. Is there anything in it?   Count the letters and numbers. If there are
 *                                 barely any, there is nothing to read.
 *
 * That is the whole filter. Anything passing both goes to the model.
 *
 * An earlier version also stripped MIME headers, multipart boundaries, RFC 2047
 * encoded-words and forwarded-message markers before counting. All of it turned
 * out to be redundant — the corrupted check already catches every message those
 * patterns were there for — and it made the filter hard to explain. A rule you
 * can't state plainly is a rule you can't defend.
 *
 * THE RULE THAT MATTERS: this only ever looks at the BODY. Never the subject,
 * never the sender. inb-005 has no subject and is the most urgent message in
 * the inbox — an existing client, angry about a fee, asking for a callback
 * today. A filter keyed on missing fields would drop him and keep the
 * newsletter. Missing metadata is normal. An empty body is not.
 *
 * Measured against the sample: the two junk messages fail (one corrupted, one
 * with zero readable characters). The eleven real ones carry 67–147 letters and
 * digits and none are corrupted. Nothing sits near the line.
 */

/**
 * Characters that never appear in text a human typed: C0 control codes (minus
 * tab, newline and carriage return, which are real formatting), DEL, and the
 * Unicode replacement character.
 */
const CORRUPTED = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\uFFFD]",
);

/**
 * Minimum letters and digits to be worth a model call.
 *
 * Not a tuned number. The junk in the sample has 0; the quietest real message
 * has 67. Anything in that gap behaves identically, so this sits well clear of
 * both rather than being fitted to the data.
 */
export const MIN_REAL_CHARS = 15;

export interface SignalCheck {
  hasSignal: boolean;
  /** The body with whitespace normalised. This is what goes to the model. */
  cleaned: string;
  /** How many letters and digits the body contains. */
  realChars: number;
  /** Plain-language reason when hasSignal is false. Rendered in the UI. */
  reason: string | null;
}

export function checkSignal(rawBody: unknown): SignalCheck {
  if (typeof rawBody !== "string") {
    return {
      hasSignal: false,
      cleaned: "",
      realChars: 0,
      reason: "the message has no body",
    };
  }

  const realChars = (rawBody.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const cleaned = rawBody.replace(/\s+/g, " ").trim();

  // 1. Is it corrupted?
  if (CORRUPTED.test(rawBody)) {
    return {
      hasSignal: false,
      cleaned,
      realChars,
      reason:
        "the message is corrupted — it contains characters that aren't readable text",
    };
  }

  // 2. Is there anything in it?
  if (realChars < MIN_REAL_CHARS) {
    return {
      hasSignal: false,
      cleaned,
      realChars,
      reason:
        realChars === 0
          ? "there's nothing to read — the message contains no letters or numbers"
          : `there's almost nothing to read — only ${realChars} letters or numbers in the whole message`,
    };
  }

  return { hasSignal: true, cleaned, realChars, reason: null };
}
