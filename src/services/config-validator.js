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

/**
 * Validates a CI/CD configuration object against the JSON Schema.
 *
 * @param {object} config — the parsed cicd-config.json content
 * @returns {{ valid: boolean, errors: import("ajv").ErrorObject[] | null }}
 */
export function validateConfig(config) {
  const valid = validate(config);
  return {
    valid,
    errors: valid ? null : [...validate.errors],
  };
}
