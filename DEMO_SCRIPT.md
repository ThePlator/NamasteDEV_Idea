# Orbit CI/CD — Demo Recording Script

**Target length:** 2:30–3:00  
**Format:** Screen recording with voiceover (or captions)

> [!IMPORTANT]
> **Before recording:** Make a copy of `src/config/cicd-config.json` and work against a throwaway version for the Apply/backup and deletion-guardrail steps. Restore the real config afterward. The `test-phase4-verification.js` script already does this safely — you can use that as a reference.

---

## 0:00–0:15 — Problem Statement

**Show:** The raw `cicd-config.json` file open in an editor, scrolled to reveal the nested structure (projects → components → ssh → commands).

**Say:**

> "Orbit CI/CD automates multi-project deployments — but configuring it means hand-writing this JSON file. For a monorepo with multiple services, each with their own deploy mode, SSH credentials, health checks, and environment variables, it's tedious and error-prone. One wrong field and your deployment pipeline breaks silently. What if you could just describe what you want in plain English?"

---

## 0:15–0:55 — Fresh Config Generation

**Show:** Navigate to `localhost:3000/config.html`. The Config Generator UI loads.

**Do:**
1. Type in the instruction box: `Express API in backend/, deploys locally via PM2, restart command pm2 reload api`
2. Click **Generate config**.
3. Wait for the diff to render (a few seconds).
4. Point to the diff output — highlight the green `➕ project "express-api"` and `➕ component "api"` lines.
5. Expand "Show full proposed config" to show the complete JSON.

**Say:**

> "I type a one-line description — 'Express API in backend, deploys locally via PM2' — and Orbit's AI generates a fully valid config fragment. You can see the diff: one new project, one new component, all the right fields filled in. The mode is 'local' so there's no SSH block — that conditional is handled automatically by the schema."

---

## 0:55–1:10 — Apply & Backup

**Do:**
1. Click **Apply changes**.
2. Show the green success banner: "✅ Config updated (backup: ...bak.timestamp)".
3. Quick cut to a file explorer or terminal: `ls src/config/` showing both `cicd-config.json` and the `.bak.TIMESTAMP` file alongside it.

**Say:**

> "One click to apply. The old config is backed up with a timestamp before anything is overwritten — atomic writes, so there's no half-written state. If anything goes wrong, the backup is right there."

---

## 1:10–1:45 — Incremental Edit (Strongest Differentiator)

**Do:**
1. Back in the UI, type a new instruction: `Add a staging environment for the API that points to the staging branch`
2. Click **Generate config**.
3. Show the diff: the ORIGINAL `api` component is **not touched** (no modify/remove lines), and a NEW `api-staging` component appears as a green addition.
4. Expand the full config to show both components side by side.

**Say (give this the most emphasis):**

> "Here's where this gets interesting. I say 'add a staging environment' — and the AI adds a *new* component called 'api-staging' alongside the original. Look at the diff carefully: the original 'api' component is completely untouched. Same path, same commands, same everything. The system doesn't mutate your existing config — it only adds to it. This is the hardest thing to get right with LLM-generated config, and it's enforced at multiple levels: the prompt rules, the schema validation, and the server-side field-loss check."

---

## 1:45–2:15 — Deletion Guardrail

**Do:**
1. Manually construct a proposedConfig that removes an existing project (or describe what you're about to do).
2. Either:
   - Use the UI to show an AI-generated config that's missing a project (if you can trigger it), **or**
   - Use `curl` or the browser console to POST a crafted `proposedConfig` to `/config/apply` that drops a project.
3. Show the **409** response and the red warning banner: "⛔ WARNING: This config would DELETE existing project(s)."

**Say:**

> "Now watch what happens if a generated config — or any config — tries to remove an existing project. The server flat-out refuses. 409 Conflict. The UI shows this unmissable red banner. This isn't just a client-side warning — the backend checks the current config on disk against the proposed one, compares every project name, every component name, and every field key. If anything would be lost, the write is blocked. The system refuses to silently destroy your existing configuration."

---

## 2:15–2:40 — Security Guardrails (Quick Montage)

**Show:** Terminal running `node --env-file=.env scripts/test-guardrails.js` with all 16 PASS results visible.

**Say:**

> "Beyond deletion protection, there's a full security layer. Path traversal — rejected. Shell injection in SSH host fields — rejected. Backticks and command substitution in deploy commands — rejected. And critically, the real production config with SmartKrishi and DevTinder still passes all checks unchanged. These guardrails are calibrated to block attacks without breaking legitimate usage."

**Show:** Scroll through the PASS results quickly — don't linger on each one, just let the viewer see the green checkmarks.

---

## 2:40–3:00 — Recap

**Show:** The Config Generator UI, then a quick diagram or bullet list overlay (optional).

**Say:**

> "So what makes this different from just wrapping an LLM in an API endpoint? It's the full pipeline: generate with schema-guided prompting, validate against a strict JSON Schema, retry once with error feedback if the output is invalid, diff against the current config, present it for human review, and then — only then — write to disk with backup and destructive-edit protection at every step. This is AI-assisted configuration, not AI-autonomous configuration. The human always has the final say."

---

## Post-Recording Checklist

- [ ] Restore the real `cicd-config.json` if you used a throwaway copy
- [ ] Verify the recording captures the diff rendering clearly (text is readable)
- [ ] Trim any dead air during the AI generation wait
- [ ] Add captions if not doing live voiceover
- [ ] Export at 1080p minimum
