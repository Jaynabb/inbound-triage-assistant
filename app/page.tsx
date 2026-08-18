import { readFileSync } from "node:fs";
import { join } from "node:path";
import TriageBoard from "./TriageBoard.tsx";
import { CATEGORY_DEFINITIONS, PRIORITY_DEFINITIONS } from "../lib/schema.ts";
import type { InboundItem } from "../lib/triage.ts";

/**
 * Server component. Reads the queue on the server and hands it to the client
 * board — the triage call itself goes through /api/triage so the API key
 * stays in the Node process.
 */
export default function Page() {
  const items: InboundItem[] = JSON.parse(
    readFileSync(join(process.cwd(), "data", "inbound.json"), "utf8"),
  );

  return (
    <main>
      <header>
        <h1>Inbound Triage Assistant</h1>
        <p>
          Northwind Advisors shared inbox — {items.length} messages. Priority
          means time pressure only; business value is tracked separately.
        </p>
      </header>

      {/* Legend renders from the same definitions the model is given, so the
          operator and the model are always reading the same rulebook. */}
      {Object.entries(PRIORITY_DEFINITIONS).map(([level, definition]) => (
        <div className="legend" key={level}>
          <span>
            <b className={`badge ${level}`}>{level}</b> {definition}
          </span>
        </div>
      ))}

      <div className="legend">
        {Object.entries(CATEGORY_DEFINITIONS).map(([name, definition]) => (
          <span key={name} title={definition}>
            {name}
          </span>
        ))}
      </div>

      <TriageBoard items={items} />
    </main>
  );
}
