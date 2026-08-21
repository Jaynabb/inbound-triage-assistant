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

/**
 * Headings are the service standard, not a mood.
 *
 * "Can wait" describes a feeling and promises nothing — which made the biggest
 * opportunity in the queue look like it was being shrugged at. "Within 2
 * business days" is a commitment. Same message, same band, completely
 * different thing to show a client.
 *
 * These standards live HERE and not in PRIORITY_DEFINITIONS, because the model
 * reads those and shouldn't read these. Putting the standards in the model's
 * rulebook cost a point on the eval — see the note in lib/schema.ts. The model
 * decides what breaks; the operator is told what we've promised.
 *
 * "Handle", not "respond": the bottom band holds both a real prospect who
 * deserves an answer and a newsletter that needs no reply ever. Archiving is
 * handling, so one verb covers the whole band without special cases.
 */
const BANDS: Array<{ key: Priority; title: string; short: string }> = [
  { key: "high", title: "Handle today", short: "Today" },
  { key: "medium", title: "Within 2 business days", short: "2 days" },
  { key: "low", title: "Within 3 business days", short: "3 days" },
];

type BandKey = Priority | "inert";

/**
 * Not every message is an email. The queue also carries web-form submissions,
 * LinkedIn messages and transcribed voicemails, and the channel changes what
 * you actually do — you call a voicemail back, you answer a LinkedIn message
 * on LinkedIn.
 *
 * It also explains the missing fields. Voicemails have no subject line, and
 * neither do most web forms. That isn't a sender being terse, it's a channel
 * that doesn't have the field — which is exactly why the pre-flight filter
 * reads the body and nothing else.
 */
const CHANNEL_LABELS: Record<string, string> = {
  email: "email",
  "web-form": "web form",
  linkedin: "linkedin",
  "voicemail-transcript": "voicemail",
};

export default function TriageBoard({ items }: { items: InboundItem[] }) {
  const [results, setResults] = useState<Record<string, TriagedItem> | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  /* When this run finished. Set on the client after the fetch resolves, so
     there's no server/client hydration mismatch on an SSR'd timestamp. */
  const [ranAt, setRanAt] = useState<string | null>(null);
  /* Null = show everything. Set by clicking a panel. */
  const [only, setOnly] = useState<BandKey | null>(null);

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
      setRanAt(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
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
        {!bands && <Tally n={items.length} label="waiting in the shared inbox" />}

        <span className="spacer" />

        {meta && (
          <span className="elapsed">
            Triaged {ranAt} · {(meta.elapsed_ms / 1000).toFixed(1)}s
          </span>
        )}

        <button className="run" onClick={run} disabled={running}>
          {running ? "Reading…" : bands ? "Run again" : "Triage the inbox"}
        </button>
      </div>

      {/* Counts panel. Every number here is real and every panel filters the
          list — no badge that doesn't do anything. */}
      {bands && (
        <div className="panels">
          {BANDS.map(({ key, short }) => (
            <Panel
              key={key}
              n={bands[key].length}
              label={short}
              tone={key}
              active={only === key}
              onClick={() => setOnly(only === key ? null : key)}
            />
          ))}
          <Panel
            n={bands.inert.length}
            label="Unreadable"
            tone="inert"
            active={only === "inert"}
            onClick={() => setOnly(only === "inert" ? null : "inert")}
          />
        </div>
      )}

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
            bands[key].length && (!only || only === key) ? (
              <Band key={key} title={title} items={bands[key]} results={results!} />
            ) : null,
          )}
          {bands.inert.length > 0 && (!only || only === "inert") && (
            <Band title="Nothing to act on" items={bands.inert} results={results!} />
          )}
        </>
      )}
    </>
  );
}

/**
 * One count panel. Clicking filters the list to that band; clicking again
 * clears it. The urgent panel carries the same negative treatment as the
 * urgent rows, so the two read as the same signal.
 */
function Panel({
  n,
  label,
  tone,
  active,
  onClick,
}: {
  n: number;
  label: string;
  tone: BandKey;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`panel panel-${tone}${active ? " is-active" : ""}${n === 0 ? " is-empty" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      disabled={n === 0}
    >
      <span className="panel-n">{n}</span>
      <span className="panel-label">{label}</span>
    </button>
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

  // Two different kinds of "look at me", so two different signals: urgency owns
  // the ink (high rows print in the negative), and anything the model couldn't
  // decide owns the brass. They never compete for the same treatment.
  const cls = [
    "row",
    inert ? "is-inert" : "",
    r && !inert ? `p-${r.priority}` : "",
    triaged.status === "review" ? "is-review" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cls}>
      <div className="row-head">
        <span className="who">
          <span className="rid">{item.id}</span>
          {/* How it arrived changes how you answer it — you call a voicemail
              back, you reply to a LinkedIn message on LinkedIn. It also
              explains missing fields: voicemails and most web forms have no
              subject line, which is why the filter never looks at one. */}
          <span className={`chan chan-${item.channel}`}>
            {CHANNEL_LABELS[item.channel] ?? item.channel}
          </span>
          <span className="sender">{item.from_name || "Unsigned"}</span>
          {item.from_org && !item.from_org.startsWith("(") && (
            <span className="org">{item.from_org}</span>
          )}
          {/* Always rendered. Showing "no subject" while never showing a
              subject flags the absence of a field the reader has never seen —
              and the absence only reads as unusual next to rows that have one. */}
          <span className={`subject${item.subject ? "" : " is-absent"}`}>
            {item.subject || "no subject"}
          </span>
        </span>

        {/* What it is, right-aligned. Identity belongs beside the sender
            rather than in a footer. */}
        {r && (
          <span className="what">
            {/* Marks the row itself, so it still reads as urgent when you've
                scrolled past the heading or filtered to a single band. */}
            {r.priority === "high" && <span className="today">today</span>}

            {/* The flag only appears when the category doesn't already say it —
                low confidence on a category the model WAS willing to pick. */}
            {triaged.status === "review" && r.category !== "needs_human" && (
              <span className="flag">needs a human</span>
            )}
            <span
              className={`tag${r.category === "needs_human" ? " tag-review" : ""}`}
            >
              {r.category.replace("_", " ")}
            </span>
          </span>
        )}
      </div>

      {r ? (
        <>
          <p className="summary">{r.summary}</p>
          {/* Labelled explicitly. It was just an arrow, and an unlabelled
              field is one a reader has to infer — including a reader checking
              it against the brief. */}
          <div className="action">
            <span className="action-label">Next</span>
            <span className="action-text">{r.next_action}</span>
          </div>
          {/* Own row, so an opened panel can take the full width instead of
              being squeezed inside the action line's flex row. */}
          {/* `why` appears only on rows flagged for a human. A tool that
              justifies all 11 decisions reads like a demo; showing its working
              on the one it wasn't sure about is what an operator actually
              needs. The reasoning stays in the saved JSON either way. */}
          <div className="toggles">
            <details className="why">
              <summary>message</summary>
              <pre className="why-body raw-body">{item.body}</pre>
            </details>
            {triaged.status === "review" && (
              <details className="why">
                <summary>why it needs a human</summary>
                <p className="why-body">{r.reasoning}</p>
              </details>
            )}
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
