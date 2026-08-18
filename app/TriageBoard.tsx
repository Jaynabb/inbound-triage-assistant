"use client";

import { useState } from "react";
import type { TriagedItem } from "../lib/schema.ts";
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
 * The whole UI. One button, one list.
 *
 * Deliberately does NOT hide failed rows. `skipped_malformed` and `error`
 * render alongside successful triage, because the graceful-failure behaviour
 * is the interesting part and filtering it out would make it invisible.
 */
export default function TriageBoard({ items }: { items: InboundItem[] }) {
  const [results, setResults] = useState<Record<string, TriagedItem>>({});
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
        // The endpoint itself failed. Surface it instead of leaving the user
        // staring at a spinner that never resolves.
        setFatal(body.error ?? `request failed (${res.status})`);
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

  return (
    <>
      <div className="bar">
        <button onClick={run} disabled={running}>
          {running ? "Triaging…" : `Triage ${items.length} messages`}
        </button>
        {meta && (
          <span className="meta">
            {meta.called} sent to model · {meta.skipped} skipped pre-flight ·{" "}
            {meta.needs_review} need review · {meta.errored} errored ·{" "}
            {(meta.elapsed_ms / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {fatal && <div className="note">Triage failed: {fatal}</div>}

      {items.map((item) => (
        <Row key={item.id} item={item} triaged={results[item.id]} />
      ))}
    </>
  );
}

function Row({ item, triaged }: { item: InboundItem; triaged?: TriagedItem }) {
  const failed =
    triaged?.status === "skipped_malformed" || triaged?.status === "error";
  const r = triaged?.result;

  return (
    <div className={`row${failed ? " failed" : ""}`}>
      <div className="row-head">
        <span className="id">{item.id}</span>
        <span className="who">{item.from_name || "(no sender)"}</span>
        {item.from_org && item.from_org !== "(individual)" && (
          <span className="subject">· {item.from_org}</span>
        )}
        <span className={`subject${item.subject ? "" : " empty"}`}>
          {item.subject || "(no subject)"}
        </span>
      </div>

      {triaged && (
        <div className="badges">
          <span className={`badge status-${triaged.status}`}>
            {triaged.status.replace("_", " ")}
          </span>
          {r && <span className="badge">{r.category}</span>}
          {r && <span className={`badge ${r.priority}`}>{r.priority}</span>}
          {r && r.value_signal !== "none" && (
            <span className="badge">value: {r.value_signal}</span>
          )}
        </div>
      )}

      {r ? (
        <>
          <div className="summary">{r.summary}</div>
          <div className="action">
            <b>Next:</b> {r.next_action}
          </div>
          <details className="why">
            <summary>why this triage (confidence {r.confidence.toFixed(2)})</summary>
            <p>{r.reasoning}</p>
          </details>
        </>
      ) : (
        !triaged && <div className="action">{item.subject || item.body.slice(0, 90)}</div>
      )}

      {triaged?.note && <div className="note">{triaged.note}</div>}
    </div>
  );
}
