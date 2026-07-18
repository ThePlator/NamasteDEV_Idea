/**
 * config-ai-service.js
 *
 * Service for generating cicd-config.json via Groq's LLM API.
 * Uses the OpenAI-compatible SDK pointed at Groq's endpoint.
 */

import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateConfig } from "./config-validator.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_NAME = "llama-3.3-70b-versatile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPT_TEMPLATE_PATH = join(__dirname, "..", "prompts", "config-generation.md");
const SCHEMA_PATH = join(__dirname, "..", "schemas", "cicd-config.schema.json");

// ── Groq Client ──────────────────────────────────────────────────────────────

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the full LLM prompt by reading the markdown template and injecting
 * the JSON schema, current config, and user instruction into the placeholders.
 *
 * @param {string}      instruction   — natural-language instruction from the user
 * @param {object|null} currentConfig — the current cicd-config.json content, or null
 * @returns {string} the assembled prompt text
 */
export function buildPrompt(instruction, currentConfig) {
  const template = readFileSync(PROMPT_TEMPLATE_PATH, "utf-8");
  const schema = readFileSync(SCHEMA_PATH, "utf-8");

  const configBlock =
    currentConfig !== null && currentConfig !== undefined
      ? JSON.stringify(currentConfig, null, 2)
      : "(none — generating fresh)";

  const prompt = template
    .replace("<SCHEMA>", schema)
    .replace("<CURRENT_CONFIG>", configBlock)
    .replace("<USER_INSTRUCTION>", instruction);

  return prompt;
}

/**
 * Calls the Groq LLM and returns the raw response text.
 * If priorErrors is provided, appends a correction message so the model
 * can fix its previous output.
 *
 * @param {string}      promptText  — the full system/user prompt
 * @param {string|null} priorErrors — validation errors from a previous attempt
 * @returns {Promise<string>} the model's raw response content
 */
async function callModel(promptText, priorErrors = null) {
  let userContent = promptText;

  if (priorErrors) {
    userContent +=
      "\n\n---\n\n" +
      "⚠️ CORRECTION REQUIRED: Your previous output failed validation with the following errors:\n\n" +
      priorErrors +
      "\n\n" +
      "Return ONLY a single corrected JSON object. No markdown fences, no explanation text, no trailing commentary.";
  }

  const response = await client.chat.completions.create({
    model: MODEL_NAME,
    messages: [{ role: "user", content: userContent }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  return response.choices[0].message.content;
}

/**
 * Attempts to parse raw model output as JSON.
 * Returns { config, error } — exactly one will be non-null.
 *
 * @param {string} raw — raw string from the model
 * @returns {{ config: object|null, error: string|null }}
 */
function tryParseJSON(raw) {
  try {
    return { config: JSON.parse(raw), error: null };
  } catch (err) {
    return {
      config: null,
      error: `JSON.parse failed: ${err.message}. Raw output: ${raw.slice(0, 300)}`,
    };
  }
}

/**
 * Formats Ajv validation errors into a human-readable string.
 *
 * @param {import("ajv").ErrorObject[]} errors
 * @returns {string}
 */
function formatAjvErrors(errors) {
  return errors
    .map((e) => `  • ${e.instancePath || "/"} ${e.message}`)
    .join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates a valid cicd-config.json object from a natural-language instruction.
 *
 * 1. Builds the prompt from the template + schema + current config + instruction.
 * 2. Calls Groq's LLM with json_object mode.
 * 3. Validates the parsed JSON against the Ajv schema.
 * 4. On failure (parse error OR schema mismatch), retries ONCE with errors fed back.
 * 5. If still invalid after the retry, throws an Error with a .details property.
 *
 * @param {string}      instruction   — natural-language instruction from the user
 * @param {object|null} [currentConfig=null] — existing config to merge with, or null
 * @returns {Promise<object>} the validated config object
 * @throws {Error} with .details if generation fails after retry
 */
export async function generateConfig(instruction, currentConfig = null) {
  const promptText = buildPrompt(instruction, currentConfig);

  // ── First attempt ──────────────────────────────────────────────────────
  const rawFirst = await callModel(promptText);
  const firstParse = tryParseJSON(rawFirst);

  if (firstParse.config) {
    const firstValidation = validateConfig(firstParse.config);
    if (firstValidation.valid) {
      return firstParse.config;
    }

    // Schema validation failed → retry with error feedback
    const errorText = formatAjvErrors(firstValidation.errors);
    return await retryWithErrors(promptText, errorText);
  }

  // JSON parse itself failed → retry with parse error
  return await retryWithErrors(promptText, firstParse.error);
}

/**
 * Retries the model call once with prior errors fed back.
 * Throws if the retry also fails.
 *
 * @param {string} promptText — original prompt
 * @param {string} errorText  — description of what went wrong
 * @returns {Promise<object>} the validated config object
 * @throws {Error} with .details
 */
async function retryWithErrors(promptText, errorText) {
  const rawRetry = await callModel(promptText, errorText);
  const retryParse = tryParseJSON(rawRetry);

  if (!retryParse.config) {
    const err = new Error(
      "AI config generation failed: model returned invalid JSON after retry."
    );
    err.details = retryParse.error;
    throw err;
  }

  const retryValidation = validateConfig(retryParse.config);
  if (retryValidation.valid) {
    return retryParse.config;
  }

  const err = new Error(
    "AI config generation failed: output does not match schema after retry."
  );
  err.details = formatAjvErrors(retryValidation.errors);
  throw err;
}
