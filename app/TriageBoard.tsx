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
 * Before triage: arrival order, quiet, one clear action.
 * After triage: regrouped by how fast the firm has to move, because that's the
 * only question the page exists to answer.
 *
 * Failed and unreadable rows stay on the page. Hiding them would hide the
 * behaviour worth looking at.
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

  const counts = bands
    ? { high: bands.high.length, medium: bands.medium.length, low: bands.low.length, inert: bands.inert.length }
    : null;

  return (
    <>
      <div className="shape">
        {counts ? (
          <>
            <Tally n={counts.high} label="today" tone="urgent" />
            <Tally n={counts.medium} label="can wait" />
            <Tally n={counts.low} label="no rush" tone="quiet" />
            <Tally n={counts.inert} label="unreadable" tone="quiet" />
          </>
        ) : (
          <Tally n={items.length} label="messages waiting" />
        )}

        <span className="spacer" />

        {meta && (
          <span className="elapsed">
            {meta.called} sent to the model · {meta.skipped} filtered ·{" "}
            {(meta.elapsed_ms / 1000).toFixed(1)}s
          </span>
        )}

        <button className="run" onClick={run} disabled={running}>
          {running ? "Reading the inbox…" : results ? "Triage again" : "Triage the inbox"}
        </button>
      </div>

      {fatal && <div className="fatal">{fatal}</div>}

      {!bands &&
        items.map((item) => <Row key={item.id} item={item} />)}

      {bands && (
        <>
          {BANDS.map(({ key, title }) =>
            bands[key].length ? (
              <section key={key}>
                <div className="band">
                  <span className="band-title">{title}</span>
                  <span className="band-rule" />
                  <span className="band-n">{bands[key].length}</span>
                </div>
                {bands[key].map((item) => (
                  <Row key={item.id} item={item} triaged={results![item.id]} />
                ))}
              </section>
            ) : null,
          )}

          {bands.inert.length > 0 && (
            <section>
              <div className="band">
                <span className="band-title">Nothing to act on</span>
                <span className="band-rule" />
                <span className="band-n">{bands.inert.length}</span>
              </div>
              {bands.inert.map((item) => (
                <Row key={item.id} item={item} triaged={results![item.id]} />
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}

function Tally({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "urgent" | "quiet";
}) {
  return (
    <span className={`tally${tone ? ` is-${tone}` : ""}`}>
      <span className="tally-n">{n}</span>
      <span className="tally-label">{label}</span>
    </span>
  );
}

function Row({ item, triaged }: { item: InboundItem; triaged?: TriagedItem }) {
  const r = triaged?.result;
  const inert =
    triaged?.status === "skipped_malformed" || triaged?.status === "error";

  const cls = [
    "row",
    !triaged ? "is-pending" : "",
    inert ? "is-inert" : "",
    r && !inert ? `p-${r.priority}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cls}>
      <div className="row-head">
        <span className="rid">{item.id}</span>
        <span className="sender">{item.from_name || "Unsigned"}</span>
        {item.from_org && !item.from_org.startsWith("(") && (
          <span className="org">{item.from_org}</span>
        )}
        <span className={`subject${item.subject ? "" : " is-absent"}`}>
          {item.subject || "no subject line"}
        </span>
      </div>

      {r ? (
        <>
          <p className="summary">{r.summary}</p>
          <p className="action">
            <span className="action-arrow">→</span>
            <span>{r.next_action}</span>
          </p>

          <div className="meta">
            <span className="tag">{r.category.replace("_", " ")}</span>

            {/* Brass appears only when there is money on the table. */}
            {(r.value_signal === "high" || r.value_signal === "medium") && (
              <span className="worth">{r.value_signal} value</span>
            )}

            {triaged?.status === "review" && (
              <span className="flag">needs a human</span>
            )}

            <details className="why">
              <summary>why · {Math.round(r.confidence * 100)}% sure</summary>
              <p className="why-body">{r.reasoning}</p>
            </details>
          </div>

          {triaged?.note && <p className="note">{triaged.note}</p>}
        </>
      ) : triaged ? (
        <p className="note">{triaged.note}</p>
      ) : (
        <p className="raw">{item.body.slice(0, 96).trim() || "—"}</p>
      )}
    </article>
  );
}
