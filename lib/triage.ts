import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  TriageResultSchema,
  CONFIDENCE_FLOOR,
  type TriageResult,
  type TriagedItem,
} from "./schema.ts";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.ts";
import { checkSignal } from "./signal.ts";

/**
 * The LLM integration.
 *
 * Three layers of defence, because each catches something the others cannot:
 *
 *   1. Forced tool use  — the API constrains the SHAPE. The model cannot
 *                         return prose, markdown fences, or a missing field.
 *   2. zod validation   — catches SEMANTIC violations the JSON schema permits.
 *                         A 400-character "one line summary" is valid JSON and
 *                         still wrong.
 *   3. One retry        — the validation error is fed back to the model. Beyond
 *                         that we stop and surface an honest error rather than
 *                         looping.
 *
 * Layer 2 is the one people skip. Tool use guarantees types and enums; it does
 * not guarantee the values make sense.
 */

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** Generated from the zod schema — never hand-written, so it cannot drift. */
const TOOL_INPUT_SCHEMA = zodToJsonSchema(TriageResultSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;

const TRIAGE_TOOL: Anthropic.Tool = {
  name: "triage",
  description:
    "Record the triage result for one inbound message. Call exactly once.",
  input_schema: TOOL_INPUT_SCHEMA as Anthropic.Tool["input_schema"],
};

export interface InboundItem {
  id: string;
  received_at: string;
  channel: string;
  from_name: string;
  from_org: string;
  subject: string;
  body: string;
}

export interface TriageOptions {
  model?: string;
  /** Injected so tests can run without network. */
  client?: Anthropic;
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.",
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Cosmetic fields are repaired, not rejected.
 *
 * Tiered by consequence:
 *   - category / priority / value_signal DRIVE ROUTING. A wrong value sends a
 *     client to the wrong queue, so these hard-fail and trigger a retry.
 *   - summary / reasoning are DISPLAY ONLY. An over-long explanation is a
 *     cosmetic defect. Rejecting an otherwise-correct triage over it — and
 *     paying for another API call — is the wrong severity of response.
 *
 * Measured motivation: after few-shot examples were added, 5 of 11 calls (45%)
 * overran the reasoning limit. Every one was otherwise correct.
 */
const COSMETIC_LIMITS = [
  ["summary", 200],
  ["reasoning", 300],
] as const;

function repairCosmetic(input: unknown): { value: unknown; repairs: string[] } {
  if (typeof input !== "object" || input === null) {
    return { value: input, repairs: [] };
  }
  const obj = { ...(input as Record<string, unknown>) };
  const repairs: string[] = [];

  for (const [field, max] of COSMETIC_LIMITS) {
    const v = obj[field];
    if (typeof v === "string" && v.length > max) {
      obj[field] = v.slice(0, max - 1).trimEnd() + "…";
      repairs.push(`${field} truncated ${v.length}→${max}`);
    }
  }
  return { value: obj, repairs };
}

/** Pull the tool_use input out of a response, or explain why we couldn't. */
function extractToolInput(
  message: Anthropic.Message,
): { ok: true; input: unknown } | { ok: false; reason: string } {
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .slice(0, 160);
    return {
      ok: false,
      reason: `model returned no tool_use block (stop_reason=${message.stop_reason})${
        text ? `: ${text}` : ""
      }`,
    };
  }
  return { ok: true, input: block.input };
}

/**
 * Triage a single message.
 *
 * Never throws. Every failure path resolves to a TriagedItem with a status the
 * UI can render, because one bad message must not take down the queue.
 */
export async function triageOne(
  item: InboundItem,
  opts: TriageOptions = {},
): Promise<TriagedItem> {
  // Layer 0: don't spend an API call on content-free input.
  const signal = checkSignal(item.body);
  if (!signal.hasSignal) {
    return {
      id: item.id,
      status: "skipped_malformed",
      result: null,
      note: signal.reason,
      latency_ms: null,
    };
  }

  const model = opts.model ?? process.env.TRIAGE_MODEL ?? DEFAULT_MODEL;
  let client: Anthropic;
  try {
    client = opts.client ?? getClient();
  } catch (err) {
    return {
      id: item.id,
      status: "error",
      result: null,
      note: err instanceof Error ? err.message : String(err),
      latency_ms: null,
    };
  }

  const system = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ ...item, cleanedBody: signal.cleaned });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  const started = Date.now();
  let lastProblem = "unknown";
  /** Validation error from attempt 1, kept so a successful repair is visible. */
  let firstProblem: string | null = null;

  // Attempt 1, then one corrective retry. Two total — deliberately not a loop.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        // Deterministic: this is classification, not composition. Same message
        // in, same triage out — an operator re-running the queue should not see
        // categories shuffle.
        temperature: 0,
        system,
        tools: [TRIAGE_TOOL],
        tool_choice: { type: "tool", name: "triage" },
        messages,
      });

      const extracted = extractToolInput(response);
      if (!extracted.ok) {
        lastProblem = extracted.reason;
      } else {
        // Repair cosmetic overruns first, so only routing-field defects can
        // cost a retry.
        const { value: repairedInput, repairs } = repairCosmetic(extracted.input);
        const parsed = TriageResultSchema.safeParse(repairedInput);
        if (parsed.success) {
          return finalise(
            item.id,
            parsed.data,
            Date.now() - started,
            firstProblem,
            repairs,
          );
        }
        lastProblem = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
      }
      if (attempt === 1) firstProblem = lastProblem;

      // Feed the specific failure back so the retry is corrective, not a
      // blind re-roll of the same request.
      //
      // The API requires that an assistant turn containing a tool_use block be
      // followed immediately by a tool_result for that exact id — a plain text
      // reply is rejected with a 400. So the correction has to travel INSIDE a
      // tool_result. (Found by running it: the first version of this retry
      // 400'd on every message that failed validation.)
      if (attempt === 1) {
        const toolUse = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        const correction =
          `Schema validation rejected that result: ${lastProblem}. ` +
          `Call the triage tool again, correcting exactly that problem and changing nothing else.`;

        messages.push({ role: "assistant", content: response.content });
        messages.push(
          toolUse
            ? {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    is_error: true,
                    content: correction,
                  },
                ],
              }
            : { role: "user", content: correction },
        );
      }
    } catch (err) {
      // Network, auth, rate limit, overload. Retry once on transient classes;
      // fail immediately on anything that a retry cannot fix.
      const status =
        err instanceof Anthropic.APIError ? err.status ?? 0 : 0;
      const transient = status === 429 || status === 529 || status >= 500 || status === 0;
      lastProblem = err instanceof Error ? err.message : String(err);

      if (!transient || attempt === 2) {
        return {
          id: item.id,
          status: "error",
          result: null,
          note: `API error: ${lastProblem}`,
          latency_ms: Date.now() - started,
        };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return {
    id: item.id,
    status: "error",
    result: null,
    note: `failed schema validation twice — ${lastProblem}`,
    latency_ms: Date.now() - started,
  };
}

/**
 * Apply the confidence floor.
 *
 * This is the guard against `unclear` becoming a dumping ground, and against
 * the opposite failure — a confidently wrong label on a real client. Anything
 * the model is unsure about is marked for review REGARDLESS of which category
 * it picked, so low confidence surfaces rather than hides.
 */
function finalise(
  id: string,
  result: TriageResult,
  latency_ms: number,
  repaired_from: string | null = null,
  truncations: string[] = [],
): TriagedItem {
  const needsReview =
    result.confidence < CONFIDENCE_FLOOR || result.category === "unclear";
  return {
    id,
    status: needsReview ? "review" : "ok",
    result,
    note: needsReview
      ? result.category === "unclear"
        ? "model could not determine intent"
        : `low confidence (${result.confidence.toFixed(2)} < ${CONFIDENCE_FLOOR})`
      : null,
    latency_ms,
    repaired_from,
    truncations,
  };
}

/**
 * Triage a queue with bounded concurrency.
 *
 * Sequential would be ~13 round trips of dead time; unbounded Promise.all
 * would rate-limit instantly at any real volume. A small pool is the honest
 * middle and is the shape that survives the 10k/day question.
 */
export async function triageAll(
  items: InboundItem[],
  opts: TriageOptions & { concurrency?: number } = {},
): Promise<TriagedItem[]> {
  const concurrency = opts.concurrency ?? 4;
  const results: TriagedItem[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await triageOne(items[index], opts);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}
