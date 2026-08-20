/**
 * Run the triage queue from the command line and print a readable table.
 *
 * This is the harness I used to develop and check the prompt without clicking
 * through the UI, and it doubles as the benchmark runner.
 *
 * Run:
 *   node --env-file=.env.local scripts/run-triage.mts
 *   node --env-file=.env.local scripts/run-triage.mts --model claude-sonnet-5 --save outputs/sonnet.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { triageAll, type InboundItem } from "../lib/triage.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const model = flag("model");
const savePath = flag("save");

const items: InboundItem[] = JSON.parse(
  readFileSync(new URL("../data/inbound.json", import.meta.url), "utf8"),
);

console.log(`triaging ${items.length} messages${model ? ` with ${model}` : " (default model)"}...\n`);

const started = Date.now();
const results = await triageAll(items, model ? { model } : {});
const elapsed = Date.now() - started;

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

console.log(
  pad("id", 9) + pad("status", 19) + pad("category", 17) + pad("pri", 8) + "summary",
);
console.log("-".repeat(118));

for (const r of results) {
  const c = r.result;
  console.log(
    pad(r.id, 9) +
      pad(r.status, 19) +
      pad(c?.category ?? "—", 17) +
      pad(c?.priority ?? "—", 8) +
      (c?.summary ?? r.note ?? ""),
  );
}

console.log("-".repeat(118));

const byStatus = results.reduce<Record<string, number>>((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});
const called = results.filter((r) => r.latency_ms !== null);
const avgLatency = called.length
  ? Math.round(called.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / called.length)
  : 0;

console.log(
  Object.entries(byStatus)
    .map(([k, v]) => `${k}: ${v}`)
    .join("  |  "),
);
console.log(
  `api calls: ${called.length}/${results.length} (${results.length - called.length} skipped pre-flight)  |  ` +
    `avg ${avgLatency}ms  |  wall ${(elapsed / 1000).toFixed(1)}s`,
);

if (savePath) {
  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(savePath, JSON.stringify({ model: model ?? "default", results }, null, 2));
  console.log(`\nsaved -> ${savePath}`);
}
