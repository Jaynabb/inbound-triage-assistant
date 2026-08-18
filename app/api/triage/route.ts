import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { triageAll, type InboundItem } from "../../../lib/triage.ts";

/**
 * Server-side triage endpoint.
 *
 * This route exists specifically so the API key never reaches the browser.
 * The Anthropic client is constructed inside this Node process; the front end
 * only ever sees triage results over JSON. That is an explicit constraint in
 * the brief, and it's the reason the app isn't a single client-side component.
 */

// Reads the queue from disk. The data layer is a JSON file by choice — the
// brief allows Airtable or local storage and scores them equally, and a local
// file keeps the whole thing runnable with `npm run dev` and no external setup.
function loadInbound(): InboundItem[] {
  const path = join(process.cwd(), "data", "inbound.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function POST() {
  try {
    const items = loadInbound();
    const started = Date.now();
    const results = await triageAll(items);

    return NextResponse.json({
      results,
      meta: {
        total: results.length,
        called: results.filter((r) => r.latency_ms !== null).length,
        skipped: results.filter((r) => r.status === "skipped_malformed").length,
        errored: results.filter((r) => r.status === "error").length,
        needs_review: results.filter((r) => r.status === "review").length,
        elapsed_ms: Date.now() - started,
      },
    });
  } catch (err) {
    // A failure here means something structural — the data file is missing or
    // unparseable. Return a real status code with a readable message rather
    // than letting the route throw an opaque 500.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
