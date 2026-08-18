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

// Threshold sensitivity: prove the magic number isn't load-bearing.
const charCounts = items.map((i) => checkSignal(i.body).realChars).sort((a, b) => a - b);
const maxSkipped = Math.max(
  ...items.filter((i) => EXPECT_SKIPPED.has(i.id)).map((i) => checkSignal(i.body).realChars),
);
const minKept = Math.min(
  ...items.filter((i) => !EXPECT_SKIPPED.has(i.id)).map((i) => checkSignal(i.body).realChars),
);
console.log(
  `\nseparation: garbage tops out at ${maxSkipped} real chars, ` +
    `the quietest real message has ${minKept}. ` +
    `Any threshold in (${maxSkipped}, ${minKept}] behaves identically.`,
);
console.log(`distribution: ${charCounts.join(", ")}`);

if (failures.length) {
  console.error(`\n✗ ${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`   ${f}`);
  process.exit(1);
}
console.log("\n✓ all signal-filter assertions passed");
