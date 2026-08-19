import { readFileSync } from "node:fs";
import { join } from "node:path";
import TriageBoard from "./TriageBoard.tsx";
import type { InboundItem } from "../lib/triage.ts";

/**
 * Server component. Reads the queue on the server and hands it to the board.
 * The triage call itself goes through /api/triage so the API key never leaves
 * the Node process.
 */
export default function Page() {
  const items: InboundItem[] = JSON.parse(
    readFileSync(join(process.cwd(), "data", "inbound.json"), "utf8"),
  );

  // The sample queue is one day's mail. The date comes from the data, not the
  // clock, so the header describes what's actually on screen — and it's
  // labelled as the inbox date so it doesn't read as a stale timestamp.
  const day = new Date(items[0]?.received_at ?? Date.now()).toLocaleDateString(
    "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  );

  return (
    <main>
      <header className="masthead">
        <h1 className="firm">Northwind Advisors</h1>
        <div className="masthead-sub">
          <span>Shared inbox · triage</span>
          <span>Inbox of {day}</span>
        </div>
      </header>

      <TriageBoard items={items} />
    </main>
  );
}
