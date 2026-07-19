# Orbit CI/CD — Submission

## Project Name

**Orbit CI/CD**

## One-Sentence Pitch

A CI/CD engine where you describe deployments in plain English and the system generates, validates, and safely applies configuration — with guardrails that prevent the AI from silently breaking your existing setup.

---

## Problem It Solves

Configuring a multi-project CI/CD pipeline means hand-writing deeply nested JSON: projects, components, deployment modes (local vs. remote SSH), credentials, health checks, environment variables, and command sequences. Getting the structure wrong — a missing SSH block when mode is "remote," a typo in a deploy command, a dropped field during a manual edit — causes silent deployment failures that surface at 2 AM. For teams managing monorepos with multiple services, this configuration tax grows linearly with every new component.

---

## What's AI-Powered (and How)

Orbit uses **Groq's Llama 3.3 70B model** (via the OpenAI-compatible SDK) to generate valid `cicd-config.json` from natural-language instructions. This is not a generic "ask the AI" wrapper — it's a structured generation pipeline:

1. **Schema-guided prompting** — The LLM receives the full JSON Schema (draft-07), the current on-disk config (if editing), and explicit editing rules (e.g., "never remove an existing component unless explicitly told to") alongside the user's instruction.
2. **Validation-retry cycle** — The generated output is validated against the schema using Ajv. If validation fails, the specific errors are fed back to the model for exactly one correction attempt. No unbounded retry loops.
3. **Structured diffing** — The proposed config is diffed against the current one, producing a typed change list (add-project, remove-project, add-component, modify-component) that the user reviews before any write occurs.
4. **Destructive-edit protection** — The server-side apply endpoint compares every project name, component name, and field key between the current and proposed configs. Any deletion or field loss is rejected with a 409 and a detailed explanation — not silently applied.
5. **Input sanitization** — Path traversal (`..`), shell-injection characters (`;`, `` ` ``, `$(`, redirects), and absolute-path misuse are detected and rejected before the config reaches disk.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (v20+) with ES modules |
| Server | Express 5 |
| LLM | Groq API / Llama 3.3 70B (OpenAI-compatible SDK) |
| Schema validation | Ajv (JSON Schema draft-07) |
| Rate limiting | express-rate-limit |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Deployment engine | Shell exec + SSH (existing Orbit pipeline) |

---

## What Makes It Different

Most AI-in-a-hackathon projects call an LLM and render the response. Orbit goes further:

- **The AI doesn't have the last word — the human does.** Generated config is always presented as a diff for review before any write happens.
- **The system protects you from the AI.** If the LLM drops an existing project, renames a component, or loses a field, the server catches it and blocks the write with a specific error message. This isn't theoretical — it's tested against the real production config on every run.
- **Guardrails are calibrated, not generic.** The shell-metacharacter blocklist was derived from how the actual `deploy-service.js` and `ssh-service.js` execute commands (direct `exec()` interpolation), and tuned to reject attacks without breaking legitimate commands like `pm2 reload app` or `pip install -r requirements.txt`.
- **Atomic writes with backups.** Config is written to a `.tmp` file first, then renamed over the real file. The previous version is preserved as a timestamped `.bak` file.
- **It works with messy real configs.** The schema uses `additionalProperties: true` on project/component definitions so fields the AI doesn't know about (health checks, dependency files, environment variable lists) pass through validation and are preserved in the AI's output.

---

## Links

| Resource | URL |
|----------|-----|
| **Live Demo** | `[TODO: add URL]` |
| **GitHub Repository** | `[TODO: add URL]` |
| **Demo Video** | `[TODO: add URL]` |
