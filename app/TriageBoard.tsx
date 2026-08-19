"use client";

import { useMemo, useState } from "react";
import type { TriagedItem, Priority } from "../lib/schema.ts";
import type { InboundItem } from "../lib/triage.ts";

interface Meta {
  total: number;
  called: number;
  skipped: number;
  errored: number;
  needs_review: number;
  elapsed_ms: number;
}

/**
 * The board.
 *
 * Starts empty. Raw untriaged messages are never rendered — in production n8n
 * fires the triage the moment a message lands, so a pile of unprocessed mail
 * isn't a state that exists. The button stands in for that trigger.
 *
 * After triage, rows are grouped by how fast the firm has to move, because
 * that's the only question this page exists to answer. Unreadable and errored
 * messages stay on screen; hiding them would hide the behaviour worth seeing.
 */

/** Band headings are written from the reader's side, not the schema's. */
const BANDS: Array<{ key: Priority; title: string }> = [
  { key: "high", title: "Needs a response today" },
  { key: "medium", title: "Can wait" },
  { key: "low", title: "No rush" },
];

export default function TriageBoard({ items }: { items: InboundItem[] }) {
  const [results, setResults] = useState<Record<string, TriagedItem> | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setFatal(null);
    try {
      const res = await fetch("/api/triage", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setFatal(body.error ?? `The triage request failed (${res.status}).`);
        return;
      }
      const byId: Record<string, TriagedItem> = {};
      for (const r of body.results as TriagedItem[]) byId[r.id] = r;
      setResults(byId);
      setMeta(body.meta);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const bands = useMemo(() => {
    if (!results) return null;
    const grouped: Record<string, InboundItem[]> = {
      high: [], medium: [], low: [], inert: [],
    };
    for (const item of items) {
      const r = results[item.id];
      const p = r?.result?.priority;
      grouped[p && r.status !== "error" ? p : "inert"].push(item);
    }
    return grouped;
  }, [results, items]);

  return (
    <>
      <div className="shape">
        {bands ? (
          <>
            <Tally n={bands.high.length} label="need a response today" />
            <span className="rest">
              {bands.medium.length} can wait · {bands.low.length} no rush ·{" "}
              {bands.inert.length} unreadable
            </span>
          </>
        ) : (
          <Tally n={items.length} label="waiting in the shared inbox" />
        )}

        <span className="spacer" />

        {meta && <span className="elapsed">{(meta.elapsed_ms / 1000).toFixed(1)}s</span>}

        <button className="run" onClick={run} disabled={running}>
          {running ? "Reading…" : bands ? "Run again" : "Triage the inbox"}
        </button>
      </div>

      {fatal && <div className="fatal">{fatal}</div>}

      {!bands && !fatal && (
        <p className="standin">
          In production n8n runs this the moment a message arrives. Here it's a
          button.
        </p>
      )}

      {bands && (
        <>
          {BANDS.map(({ key, title }) =>
            bands[key].length ? (
              <Band key={key} title={title} items={bands[key]} results={results!} />
            ) : null,
          )}
          {bands.inert.length > 0 && (
            <Band title="Nothing to act on" items={bands.inert} results={results!} />
          )}
        </>
      )}
    </>
  );
}

function Band({
  title,
  items,
  results,
}: {
  title: string;
  items: InboundItem[];
  results: Record<string, TriagedItem>;
}) {
  return (
    <section>
      <div className="band">
        <span className="band-title">{title}</span>
        <span className="band-rule" />
        <span className="band-n">{items.length}</span>
      </div>
      {items.map((item) => (
        <Row key={item.id} item={item} triaged={results[item.id]} />
      ))}
    </section>
  );
}

function Tally({ n, label }: { n: number; label: string }) {
  return (
    <span className="tally">
      <span className="tally-n">{n}</span>
      <span className="tally-label">{label}</span>
    </span>
  );
}

function Row({ item, triaged }: { item: InboundItem; triaged: TriagedItem }) {
  const r = triaged.result;
  const inert =
    triaged.status === "skipped_malformed" || triaged.status === "error";

  const cls = ["row", inert ? "is-inert" : "", r && !inert ? `p-${r.priority}` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cls}>
      <div className="row-head">
        <span className="who">
          <span className="rid">{item.id}</span>
          <span className="sender">{item.from_name || "Unsigned"}</span>
          {item.from_org && !item.from_org.startsWith("(") && (
            <span className="org">{item.from_org}</span>
          )}
          {!item.subject && <span className="subject is-absent">no subject</span>}
        </span>

        {/* What it is, right-aligned. Identity belongs beside the sender, not
            in a footer. Brass appears only when there's money on the table. */}
        {r && (
          <span className="what">
            {triaged.status === "review" && <span className="flag">needs a human</span>}
            {(r.value_signal === "high" || r.value_signal === "medium") && (
              <span className="worth">{r.value_signal} value</span>
            )}
            <span className="tag">{r.category.replace("_", " ")}</span>
          </span>
        )}
      </div>

      {r ? (
        <>
          <p className="summary">{r.summary}</p>
          <div className="action">
            <span className="action-arrow">→</span>
            <span className="action-text">{r.next_action}</span>
          </div>
          {/* Own row, so an opened panel can take the full width instead of
              being squeezed inside the action line's flex row. */}
          <div className="toggles">
            <details className="why">
              <summary>message</summary>
              <pre className="why-body raw-body">{item.body}</pre>
            </details>
            <details className="why">
              <summary>why</summary>
              <p className="why-body">{r.reasoning}</p>
            </details>
          </div>
        </>
      ) : (
        <>
          <p className="note">{triaged.note}</p>
          {/* Readable on the unreadable ones too — being able to see WHAT was
              rejected is the point of not dropping them silently. */}
          <details className="why why-inert">
            <summary>message</summary>
            <pre className="why-body raw-body">{item.body}</pre>
          </details>
        </>
      )}
    </article>
  );
}
