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

export async function POST(request: Request) {
  try {
    const items = loadInbound();

    // A retry from the board sends the ids it wants re-run; no body means the
    // whole queue. Retrying one message costs one API call instead of eleven,
    // which is the difference between a usable retry and a second full run.
    let queue = items;
    const body = await request.json().catch(() => null);
    const ids: unknown = body && typeof body === "object" ? (body as any).ids : null;
    const isRetry = Array.isArray(ids) && ids.length > 0;
    if (isRetry) {
      const wanted = new Set((ids as unknown[]).map(String));
      queue = items.filter((i) => wanted.has(i.id));
    }

    const started = Date.now();
    // Failure injection applies to a full run only, so a retry of a failed
    // message reaches the real API. See injectedFailure in lib/triage.ts.
    // Keyed on whether ids were sent, not on how many came back: retrying every
    // failed message at once can cover the whole queue, and that's still a
    // retry. Comparing lengths would re-fire the fault on exactly the request
    // that's trying to clear it.
    const results = await triageAll(queue, { injectFailures: !isRetry });

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
