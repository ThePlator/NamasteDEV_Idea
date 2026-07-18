#!/usr/bin/env node

/**
 * scripts/test-generate.js
 *
 * Smoke test for the AI config generation + diff pipeline.
 *
 * Phase 1: Generate a fresh config from a natural-language instruction.
 * Phase 2: Generate an updated config (passing Phase 1's result as context).
 * Phase 3: Diff the two configs and print the structured changes.
 *
 * Run:  node --env-file=.env scripts/test-generate.js
 *   or: GROQ_API_KEY=gsk_... node scripts/test-generate.js
 */

import { generateConfig } from "../src/services/config-ai-service.js";
import { diffConfigs } from "../src/services/config-diff-service.js";

// ── Phase 1 — Fresh generation ───────────────────────────────────────────────

const instruction1 =
  "Express API in backend/, deploys locally via PM2, restart command pm2 reload api";

console.log("═══ Phase 1: Fresh generation ══════════════════════════════");
console.log(`Instruction: "${instruction1}"\n`);

let config1;
try {
  config1 = await generateConfig(instruction1);
  console.log("✅ Config v1:\n");
  console.log(JSON.stringify(config1, null, 2));
} catch (err) {
  console.error("❌ Phase 1 failed:", err.message);
  if (err.details) console.error("\nDetails:\n", err.details);
  process.exit(1);
}

// ── Phase 1.5 — Diff from null (fresh) ───────────────────────────────────────

console.log("\n═══ Phase 1.5: Diff (null → v1) ════════════════════════════");
const freshDiff = diffConfigs(null, config1);
console.log(`${freshDiff.length} change(s):\n`);
for (const change of freshDiff) {
  console.log(" ", formatChange(change));
}

// ── Phase 2 — Follow-up generation with existing config ──────────────────────

const instruction2 =
  "add a staging environment for the API that points to the staging branch";

console.log("\n═══ Phase 2: Follow-up generation ═══════════════════════════");
console.log(`Instruction: "${instruction2}"`);
console.log("(passing Phase 1 config as currentConfig)\n");

let config2;
try {
  config2 = await generateConfig(instruction2, config1);
  console.log("✅ Config v2:\n");
  console.log(JSON.stringify(config2, null, 2));
} catch (err) {
  console.error("❌ Phase 2 failed:", err.message);
  if (err.details) console.error("\nDetails:\n", err.details);
  process.exit(1);
}

// ── Phase 3 — Diff v1 → v2 ──────────────────────────────────────────────────

console.log("\n═══ Phase 3: Diff (v1 → v2) ═════════════════════════════════");
const diff = diffConfigs(config1, config2);

if (diff.length === 0) {
  console.log("⚠️  No changes detected — configs are identical.");
} else {
  console.log(`${diff.length} change(s):\n`);
  for (const change of diff) {
    console.log(" ", formatChange(change));
  }
}

// ── Sanity check ─────────────────────────────────────────────────────────────

console.log("\n═══ Sanity Check ═════════════════════════════════════════════");

const hasRemove = diff.some(
  (c) => c.type === "remove-project" || c.type === "remove-component"
);
const hasModify = diff.some((c) => c.type === "modify-component");
const onlyAdds = diff.length > 0 && diff.every(
  (c) => c.type === "add-project" || c.type === "add-component"
);

if (onlyAdds) {
  console.log(
    "✅ Original component untouched — only additions detected. PASS"
  );
} else if (hasRemove) {
  console.log(
    "❌ FAIL — remove-project or remove-component entries detected. " +
    "The LLM replaced existing entries instead of adding alongside them."
  );
  process.exit(1);
} else if (hasModify) {
  console.log(
    "❌ FAIL — modify-component entries detected. " +
    "The LLM mutated existing fields instead of preserving them."
  );
  process.exit(1);
} else {
  console.log("⚠️  Unexpected diff shape (0 changes?) — review manually.");
}

// ── Formatting helper ────────────────────────────────────────────────────────

function formatChange(c) {
  switch (c.type) {
    case "add-project":
      return `➕ project "${c.project}"`;
    case "remove-project":
      return `➖ project "${c.project}"`;
    case "add-component":
      return `  ➕ component "${c.component}" in project "${c.project}"`;
    case "remove-component":
      return `  ➖ component "${c.component}" in project "${c.project}"`;
    case "modify-component":
      return (
        `  ✏️  "${c.component}" in "${c.project}" — ` +
        `${c.field}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)}`
      );
    default:
      return JSON.stringify(c);
  }
}
