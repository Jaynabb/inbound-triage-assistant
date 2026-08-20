/**
 * The pre-flight check — runs BEFORE any model call.
 *
 * One rule:
 *
 *     IF the message is BROKEN or BLANK, park it. Otherwise, triage it.
 *
 *     broken — it contains characters a person can't type: control codes, or
 *              the "�" left behind when text is decoded with the wrong
 *              encoding. The message arrived damaged.
 *
 *     blank  — it contains no letters or numbers at all. There is nothing in
 *              it to read.
 *
 * Those are two different failures — one arrived damaged, one arrived empty —
 * so no single test catches both. A letters-only check misses inb-011, which is
 * full of letters and still garbage. A corruption-only check misses inb-010,
 * which is a period, and a period is a perfectly valid character.
 *
 * An earlier version also stripped MIME headers, multipart boundaries, RFC 2047
 * encoded-words and forwarded-message markers before deciding. All of it was
 * redundant — the broken check already catches every message those patterns
 * existed for — and it made the filter impossible to state in a sentence. A
 * rule you can't say out loud is a rule you can't defend.
 *
 * THE RULE THAT MATTERS: this only ever looks at the BODY. Never the subject,
 * never the sender. inb-005 has no subject and is the most urgent message in
 * the inbox — an existing client, angry about a fee, asking for a callback
 * today. A filter keyed on missing fields would drop him and keep the
 * newsletter. Missing metadata is normal. An empty body is not.
 *
 * Against the sample: inb-011 is broken, inb-010 is blank, and all eleven real
 * messages pass.
 *
 * Known limitation: an emoji-only reply — a client sending just 👍 — counts as
 * blank and gets parked. It lands in the "couldn't read" branch rather than
 * being deleted, so it's recoverable, and there's nothing in it to triage.
 * Named rather than engineered around.
 */

/**
 * BROKEN: characters that never appear in text a human typed. C0 control codes
 * (minus tab, newline and carriage return, which are real formatting), DEL, and
 * the Unicode replacement character.
 */
const BROKEN = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\uFFFD]",
);

/**
 * BLANK is deliberately "no letters or numbers at all" — not "shorter than N".
 *
 * An earlier version required 15 characters. It looked reasonable and it was
 * wrong: a client replying "ok" is two characters. Any minimum parks it, and a
 * real client's message silently never reaching a person is the worst failure
 * this system can have.
 *
 * So there is no threshold. "ok" has two letters and goes through. "a" has one
 * and goes through, where the model can return needs_human if it can't tell
 * what's wanted. Better to spend one API call on an ambiguous message than to
 * drop a real one. Nothing left to tune, and nothing to justify.
 */
const HAS_CONTENT = /[\p{L}\p{N}]/u;

export interface SignalCheck {
  hasSignal: boolean;
  /** The body with whitespace normalised. This is what goes to the model. */
  cleaned: string;
  /** How many letters and digits the body contains. Reported, never compared. */
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
      reason: "blank — the message has no body",
    };
  }

  const realChars = (rawBody.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const cleaned = rawBody.replace(/\s+/g, " ").trim();

  if (BROKEN.test(rawBody)) {
    return {
      hasSignal: false,
      cleaned,
      realChars,
      reason: "broken — the message contains characters that aren't readable text",
    };
  }

  if (!HAS_CONTENT.test(rawBody)) {
    return {
      hasSignal: false,
      cleaned,
      realChars,
      reason: "blank — the message contains no letters or numbers",
    };
  }

  return { hasSignal: true, cleaned, realChars, reason: null };
}
