import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load and compile the schema once at module load
const schemaPath = join(__dirname, "..", "schemas", "cicd-config.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

// ── Dangerous shell patterns ─────────────────────────────────────────────────
// Blocked in ssh.host, ssh.user, and all command values.
// Allows && and || (legitimate chaining used by the deploy pipeline) but blocks
// higher-risk metacharacters that enable injection via the exec()-based runner.

const SHELL_DANGEROUS_PATTERNS = [
  { pattern: /;/, label: "semicolon (;)" },
  { pattern: /`/, label: "backtick (`)" },
  { pattern: /\$\(/, label: "command substitution ($()" },
  { pattern: /\n/, label: "newline" },
  { pattern: />\s*\//, label: "redirect to absolute path (> /)" },
  { pattern: /</, label: "input redirect (<)" },
];

// ── Path sanitization ────────────────────────────────────────────────────────

/**
 * Checks all path-related fields across all projects/components for:
 * - Path traversal (..)
 * - Absolute paths where relative is expected (component "path")
 * - Empty / whitespace-only values
 *
 * @param {object} config — parsed cicd-config.json content
 * @returns {{ valid: boolean, errors: object[] }}
 */
export function sanitizePaths(config) {
  const errors = [];

  if (!config?.projects || !Array.isArray(config.projects)) {
    return { valid: true, errors: null };
  }

  for (const [pi, project] of config.projects.entries()) {
    // Project-level: localPath (optional, but must be safe if present)
    if (project.localPath !== undefined) {
      checkPath(
        project.localPath,
        `/projects/${pi}/localPath`,
        false, // absolute IS expected for localPath
        errors
      );
    }

    if (!Array.isArray(project.components)) continue;

    for (const [ci, comp] of project.components.entries()) {
      const prefix = `/projects/${pi}/components/${ci}`;

      // Component path — must be relative
      if (comp.path !== undefined) {
        checkPath(comp.path, `${prefix}/path`, true, errors);
      }

      // SSH fields
      if (comp.ssh) {
        if (comp.ssh.remotePath !== undefined) {
          checkPath(
            comp.ssh.remotePath,
            `${prefix}/ssh/remotePath`,
            false, // absolute expected
            errors
          );
        }
        if (comp.ssh.keyPath !== undefined) {
          checkPath(
            comp.ssh.keyPath,
            `${prefix}/ssh/keyPath`,
            false, // absolute expected (e.g. ~/.ssh/id_ed25519)
            errors
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length === 0 ? null : errors,
  };
}

/**
 * Validates a single path value.
 *
 * @param {*}       value       — the path value to check
 * @param {string}  instancePath — JSON pointer for error reporting
 * @param {boolean} mustBeRelative — true if the field must be a relative path
 * @param {object[]} errors     — accumulator array
 */
function checkPath(value, instancePath, mustBeRelative, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({
      instancePath,
      schemaPath: "#/sanitizePaths",
      keyword: "sanitizePaths",
      params: { reason: "empty-or-whitespace" },
      message: "path must not be empty or whitespace-only",
    });
    return;
  }

  if (value.includes("..")) {
    errors.push({
      instancePath,
      schemaPath: "#/sanitizePaths",
      keyword: "sanitizePaths",
      params: { reason: "path-traversal" },
      message: 'path must not contain ".." (path traversal)',
    });
  }

  if (mustBeRelative && (value.startsWith("/") || value.startsWith("\\"))) {
    errors.push({
      instancePath,
      schemaPath: "#/sanitizePaths",
      keyword: "sanitizePaths",
      params: { reason: "absolute-not-allowed" },
      message: "component path must be relative (not absolute)",
    });
  }
}

// ── Shell-metacharacter sanitization ─────────────────────────────────────────

/**
 * Checks ssh.host, ssh.user, and all command values for dangerous shell
 * metacharacters that could be exploited since the deploy pipeline passes
 * these values directly into exec() / bash -lc.
 *
 * @param {object} config — parsed cicd-config.json content
 * @returns {{ valid: boolean, errors: object[] }}
 */
export function sanitizeShellFields(config) {
  const errors = [];

  if (!config?.projects || !Array.isArray(config.projects)) {
    return { valid: true, errors: null };
  }

  for (const [pi, project] of config.projects.entries()) {
    if (!Array.isArray(project.components)) continue;

    for (const [ci, comp] of project.components.entries()) {
      const prefix = `/projects/${pi}/components/${ci}`;

      // SSH host and user
      if (comp.ssh) {
        if (comp.ssh.host) {
          checkShell(comp.ssh.host, `${prefix}/ssh/host`, errors);
        }
        if (comp.ssh.user) {
          checkShell(comp.ssh.user, `${prefix}/ssh/user`, errors);
        }
      }

      // All command values (deploy, install, pull, build, test, etc.)
      if (comp.commands && typeof comp.commands === "object") {
        for (const [key, value] of Object.entries(comp.commands)) {
          const cmdValues = Array.isArray(value) ? value : [value];
          for (const cmd of cmdValues) {
            if (typeof cmd === "string") {
              checkShell(cmd, `${prefix}/commands/${key}`, errors);
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length === 0 ? null : errors,
  };
}

/**
 * Tests a single string value against the dangerous-pattern blocklist.
 *
 * @param {string}   value        — the string to check
 * @param {string}   instancePath — JSON pointer for error reporting
 * @param {object[]} errors       — accumulator array
 */
function checkShell(value, instancePath, errors) {
  for (const { pattern, label } of SHELL_DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      errors.push({
        instancePath,
        schemaPath: "#/sanitizeShellFields",
        keyword: "sanitizeShellFields",
        params: { reason: "dangerous-shell-character", character: label },
        message: `contains dangerous shell character: ${label}`,
      });
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates a CI/CD configuration object against the JSON Schema AND the
 * path / shell-injection sanitizers. A config must pass ALL three checks
 * to be considered valid.
 *
 * @param {object} config — the parsed cicd-config.json content
 * @returns {{ valid: boolean, errors: import("ajv").ErrorObject[] | null }}
 */
export function validateConfig(config) {
  const schemaResult = validate(config);
  const schemaErrors = schemaResult ? [] : [...validate.errors];

  const pathResult = sanitizePaths(config);
  const pathErrors = pathResult.errors || [];

  const shellResult = sanitizeShellFields(config);
  const shellErrors = shellResult.errors || [];

  const allErrors = [...schemaErrors, ...pathErrors, ...shellErrors];

  return {
    valid: allErrors.length === 0,
    errors: allErrors.length === 0 ? null : allErrors,
  };
}
