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
import { checkSignal, MIN_REAL_CHARS } from "../lib/signal.ts";

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

console.log(`MIN_REAL_CHARS = ${MIN_REAL_CHARS}\n`);
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
console.log("\nwhy each skip was skipped:");
for (const item of items) {
  const check = checkSignal(item.body);
  if (!check.hasSignal) {
    const rule = check.reason?.startsWith("the message is corrupted")
      ? "rule 1 — corrupted"
      : "rule 2 — nothing to read";
    console.log(`  ${item.id}  ${rule}`);
  }
}

// Threshold sensitivity, measured ONLY over messages rule 1 lets through —
// mixing in a corrupted message would produce a meaningless range.
const notCorrupted = items.filter(
  (i) => !checkSignal(i.body).reason?.startsWith("the message is corrupted"),
);
const junk = notCorrupted.filter((i) => EXPECT_SKIPPED.has(i.id));
const real = notCorrupted.filter((i) => !EXPECT_SKIPPED.has(i.id));
const maxJunk = Math.max(...junk.map((i) => checkSignal(i.body).realChars));
const minReal = Math.min(...real.map((i) => checkSignal(i.body).realChars));

console.log(
  `\nrule 2 separation: the emptiest junk message has ${maxJunk} letters/digits, ` +
    `the quietest real one has ${minReal}.\n` +
    `Any threshold in (${maxJunk}, ${minReal}] behaves identically — ` +
    `${MIN_REAL_CHARS} is not fitted to the data.`,
);
console.log(
  `distribution: ${real
    .map((i) => checkSignal(i.body).realChars)
    .sort((a, b) => a - b)
    .join(", ")}`,
);

if (failures.length) {
  console.error(`\n✗ ${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`   ${f}`);
  process.exit(1);
}
console.log("\n✓ all signal-filter assertions passed");
