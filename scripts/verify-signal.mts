/**
 * Verifies the pre-flight signal filter against the real sample data.
 *
 * This exists because the filter is the one place where a bug is invisible:
 * a message that gets silently skipped never appears in the UI to be noticed.
 * The assertions below encode the intent, not just the current behaviour.
 *
 * Run:  node scripts/verify-signal.mts
 */
import { readFileSync } from "node:fs";
import { checkSignal } from "../lib/signal.ts";

interface Inbound {
  id: string;
  subject: string;
  from_name: string;
  body: string;
}

const items: Inbound[] = JSON.parse(
  readFileSync(new URL("../data/inbound.json", import.meta.url), "utf8"),
);

/** Items we intend to skip. Everything else must reach the model. */
const EXPECT_SKIPPED = new Set(["inb-010", "inb-011"]);

/** Items that would be wrongly dropped by a naive "missing fields" filter. */
const MUST_SURVIVE = ["inb-005", "inb-008", "inb-009"];

console.log("id        chars  decision  why");
console.log("-".repeat(72));

const failures: string[] = [];

for (const item of items) {
  const check = checkSignal(item.body);
  const decision = check.hasSignal ? "SEND" : "SKIP";
  const why = check.reason ?? "";
  console.log(
    `${item.id}  ${String(check.realChars).padStart(5)}  ${decision.padEnd(8)}  ${why}`,
  );

  const shouldSkip = EXPECT_SKIPPED.has(item.id);
  if (shouldSkip && check.hasSignal) {
    failures.push(`${item.id} should have been skipped but was sent`);
  }
  if (!shouldSkip && !check.hasSignal) {
    failures.push(`${item.id} was skipped but should reach the model`);
  }
}

console.log("-".repeat(72));

// The load-bearing assertion: metadata-poor messages must still get triaged.
for (const id of MUST_SURVIVE) {
  const item = items.find((i) => i.id === id)!;
  const check = checkSignal(item.body);
  const missing = [
    !item.subject && "no subject",
    !item.from_name && "no from_name",
  ].filter(Boolean);
  if (!check.hasSignal) {
    failures.push(`${id} (${missing.join(", ")}) was skipped — naive-filter bug`);
  } else {
    console.log(`✓ ${id} survives despite: ${missing.join(", ") || "nothing missing"}`);
  }
}

// Which rule caught each skipped message. The two rules are independent, so
// reporting them together would be misleading — a corrupted message can have
// plenty of letters in it and still be junk.
console.log("\nbroken or blank?");
for (const item of items) {
  const check = checkSignal(item.body);
  if (!check.hasSignal) {
    const rule = check.reason?.startsWith("broken") ? "BROKEN" : "BLANK";
    console.log(`  ${item.id}  ${rule}`);
  }
}

/**
 * The regression that matters most.
 *
 * An earlier version required a minimum of 15 characters. It looked sensible
 * and it would have parked a client replying "ok". A real client's message
 * silently never reaching a person is the worst thing this system can do, so
 * short-but-real bodies get asserted rather than assumed.
 */
const MUST_PASS_SHORT = ["ok", "yes please", "a", "Yes.", "call me", "no thanks"];

console.log("\nnot blank — short but real, these must get through:");
for (const body of MUST_PASS_SHORT) {
  const check = checkSignal(body);
  const mark = check.hasSignal ? "✓" : "✗";
  console.log(`  ${mark} ${JSON.stringify(body).padEnd(14)} ${body.length} chars`);
  if (!check.hasSignal) {
    failures.push(`"${body}" was parked — a real short reply must reach the model`);
  }
}

/** And things with genuinely nothing in them must not. */
const MUST_BE_PARKED = [".", "  ", "...", "-", "?!"];

console.log("\nblank — these must be parked:");
for (const body of MUST_BE_PARKED) {
  const check = checkSignal(body);
  const mark = !check.hasSignal ? "✓" : "✗";
  console.log(`  ${mark} ${JSON.stringify(body)}`);
  if (check.hasSignal) {
    failures.push(`"${body}" got through — it is blank, no letters or numbers`);
  }
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`   ${f}`);
  process.exit(1);
}
console.log("\n✓ all signal-filter assertions passed");
