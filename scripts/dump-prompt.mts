/**
 * Print the rendered system prompt to stdout.
 *
 * The prompt is generated from lib/schema.ts, so this exists to snapshot it
 * into prompts/triage.system.txt — reviewable without running the app, and
 * regenerated rather than edited by hand so it can't drift from the code.
 *
 * Run:  node scripts/dump-prompt.mts > prompts/triage.system.txt
 */
import { buildSystemPrompt } from "../lib/prompt.ts";

process.stdout.write(buildSystemPrompt() + "\n");
