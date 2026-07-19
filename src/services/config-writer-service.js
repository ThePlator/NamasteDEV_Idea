/**
 * config-writer-service.js
 *
 * Service for writing validated cicd-config.json back to disk.
 * Uses atomic writes (write to .tmp, then rename) and creates timestamped
 * backups before overwriting.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Paths ────────────────────────────────────────────────────────────────────

/** Canonical path to cicd-config.json used across the project. */
export const CONFIG_PATH = join(__dirname, "..", "config", "cicd-config.json");

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the current cicd-config.json from disk.
 * Returns null if the file does not exist.
 *
 * @returns {object|null} the parsed config, or null
 */
export function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Writes a validated config object to cicd-config.json.
 *
 * 1. If the file already exists, backs it up to cicd-config.json.bak.<timestamp>.
 * 2. Writes to a .tmp file first, then atomically renames over the real path.
 *
 * @param {object} config — the validated configuration to persist
 * @returns {{ backupPath: string|null }} info about the backup created
 */
export function writeConfig(config) {
  const tmpPath = CONFIG_PATH + ".tmp";
  let backupPath = null;

  // Back up the existing file if present
  if (existsSync(CONFIG_PATH)) {
    const timestamp = Date.now();
    backupPath = `${CONFIG_PATH}.bak.${timestamp}`;
    const existing = readFileSync(CONFIG_PATH, "utf-8");
    writeFileSync(backupPath, existing, "utf-8");
  }

  // Atomic write: tmp → rename
  const content = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, CONFIG_PATH);

  return { backupPath };
}
