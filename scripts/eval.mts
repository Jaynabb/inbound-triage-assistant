/**
 * Score model output against the hand-built answer key.
 *
 * The key (eval/answer-key.json) was written before looking at any model
 * output, so this measures the model against a spec rather than describing
 * what it happened to do. Re-run after any prompt change to see whether the
 * change actually helped — the point is to replace "that looks better" with
 * a number.
 *
 * Run:
 *   node --env-file=.env.local scripts/eval.mts
 *   node --env-file=.env.local scripts/eval.mts --model claude-sonnet-5
 *   node --env-file=.env.local scripts/eval.mts --from outputs/haiku.json   (score a saved run)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { triageAll, type InboundItem } from "../lib/triage.ts";
import type { TriagedItem } from "../lib/schema.ts";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

interface Expected {
  category: string | null;
  priority: string | null;
  expected_status?: string;
  why: string;
}

const key = JSON.parse(
  readFileSync(new URL("../eval/answer-key.json", import.meta.url), "utf8"),
) as { expected: Record<string, Expected> };

const items: InboundItem[] = JSON.parse(
  readFileSync(new URL("../data/inbound.json", import.meta.url), "utf8"),
);

const model = flag("model");
const from = flag("from");
const label = flag("label") ?? model ?? "default";

let results: TriagedItem[];
if (from) {
  results = JSON.parse(readFileSync(from, "utf8")).results;
  console.log(`scoring saved run: ${from}\n`);
} else {
  console.log(`running ${items.length} messages${model ? ` on ${model}` : ""}...\n`);
  results = await triageAll(items, model ? { model } : {});
}

let catRight = 0;
let catTotal = 0;
let priRight = 0;
let priTotal = 0;
let statusRight = 0;
let statusTotal = 0;
const disagreements: string[] = [];

for (const r of results) {
  const exp = key.expected[r.id];
  if (!exp) continue;

  // Items the key says should never reach the model.
  if (exp.expected_status) {
    statusTotal++;
    if (r.status === exp.expected_status) {
      statusRight++;
    } else {
      disagreements.push(
        `${r.id}  status: expected ${exp.expected_status}, got ${r.status}`,
      );
    }
    continue;
  }

  if (!r.result) {
    catTotal++;
    priTotal++;
    disagreements.push(`${r.id}  no result (status=${r.status}): ${r.note ?? ""}`);
    continue;
  }

  catTotal++;
  if (r.result.category === exp.category) catRight++;
  else
    disagreements.push(
      `${r.id}  category: expected ${exp.category}, got ${r.result.category}`,
    );

  priTotal++;
  if (r.result.priority === exp.priority) priRight++;
  else
    disagreements.push(
      `${r.id}  priority: expected ${exp.priority}, got ${r.result.priority}\n` +
        `            key: ${exp.why}`,
    );
}

const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(0) : "—");

console.log("=".repeat(72));
console.log(`  EVAL — ${label}`);
console.log("=".repeat(72));
console.log(`  category   ${catRight}/${catTotal}   ${pct(catRight, catTotal)}%`);
console.log(`  priority   ${priRight}/${priTotal}   ${pct(priRight, priTotal)}%`);
console.log(`  pre-filter ${statusRight}/${statusTotal}   ${pct(statusRight, statusTotal)}%`);
const overall = catRight + priRight + statusRight;
const overallTotal = catTotal + priTotal + statusTotal;
console.log(`  OVERALL    ${overall}/${overallTotal}   ${pct(overall, overallTotal)}%`);
console.log("=".repeat(72));

if (disagreements.length) {
  console.log("\ndisagreements:");
  for (const d of disagreements) console.log(`  ${d}`);
} else {
  console.log("\nno disagreements.");
}

const called = results.filter((r) => r.latency_ms !== null).length;

// Deliberately reported as two separate numbers. Retries cost an extra API
// call; truncations cost nothing. Tiering the validation was meant to convert
// the first into the second, and one combined counter would hide that entirely.
const retried = results.filter((r) => r.repaired_from);
const truncated = results.filter((r) => r.truncations?.length);

console.log(
  `\nretries (extra API call):  ${retried.length}/${called}` +
    (retried.length ? "" : "   ← none"),
);
for (const r of retried) console.log(`    ${r.id}: ${r.repaired_from}`);

console.log(`truncations (free):        ${truncated.length}/${called}`);
for (const r of truncated) console.log(`    ${r.id}: ${r.truncations!.join(", ")}`);

const savePath = flag("save");
if (savePath) {
  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(
    savePath,
    JSON.stringify(
      { label, category: [catRight, catTotal], priority: [priRight, priTotal], disagreements, results },
      null,
      2,
    ),
  );
  console.log(`\nsaved -> ${savePath}`);
}
