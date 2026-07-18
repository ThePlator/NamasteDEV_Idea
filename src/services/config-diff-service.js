/**
 * config-diff-service.js
 *
 * Service for computing structured diffs between two cicd-config.json versions.
 * Produces an array of typed change objects that downstream consumers
 * (CLI display, approval UI, audit log) can interpret uniformly.
 */

// ── Fields to compare on each component ──────────────────────────────────────

/** Flat scalar fields on a component that we diff individually. */
const SCALAR_FIELDS = ["mode", "path"];

/** Nested objects whose child keys we diff as "field.subfield". */
const NESTED_FIELDS = ["ssh", "commands"];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a lookup map: project-name → { project, components-by-name }.
 *
 * @param {object} config — a validated cicd-config object (has .projects[])
 * @returns {Map<string, { project: object, components: Map<string, object> }>}
 */
function indexConfig(config) {
  const map = new Map();

  for (const project of config.projects) {
    const components = new Map();
    for (const comp of project.components) {
      components.set(comp.name, comp);
    }
    map.set(project.name, { project, components });
  }

  return map;
}

/**
 * Compares two component objects and returns an array of "modify-component"
 * change objects for every field that differs.
 *
 * @param {string} projectName
 * @param {string} componentName
 * @param {object} oldComp
 * @param {object} newComp
 * @returns {Array<object>}
 */
function diffComponent(projectName, componentName, oldComp, newComp) {
  const changes = [];

  // Compare scalar fields
  for (const field of SCALAR_FIELDS) {
    const oldVal = oldComp[field];
    const newVal = newComp[field];
    if (oldVal !== newVal) {
      changes.push({
        type: "modify-component",
        project: projectName,
        component: componentName,
        field,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }

  // Compare nested objects (ssh, commands)
  for (const field of NESTED_FIELDS) {
    const oldNested = oldComp[field] || {};
    const newNested = newComp[field] || {};

    // Handle presence / absence of the entire nested block
    const oldExists = field in oldComp;
    const newExists = field in newComp;

    if (!oldExists && !newExists) continue;

    if (!oldExists && newExists) {
      // Entire nested block was added — report each sub-key
      for (const [subKey, subVal] of Object.entries(newNested)) {
        changes.push({
          type: "modify-component",
          project: projectName,
          component: componentName,
          field: `${field}.${subKey}`,
          oldValue: undefined,
          newValue: subVal,
        });
      }
      continue;
    }

    if (oldExists && !newExists) {
      // Entire nested block was removed — report each sub-key
      for (const [subKey, subVal] of Object.entries(oldNested)) {
        changes.push({
          type: "modify-component",
          project: projectName,
          component: componentName,
          field: `${field}.${subKey}`,
          oldValue: subVal,
          newValue: undefined,
        });
      }
      continue;
    }

    // Both exist — compare each sub-key (union of keys from both)
    const allSubKeys = new Set([
      ...Object.keys(oldNested),
      ...Object.keys(newNested),
    ]);

    for (const subKey of allSubKeys) {
      const oldVal = oldNested[subKey];
      const newVal = newNested[subKey];
      if (oldVal !== newVal) {
        changes.push({
          type: "modify-component",
          project: projectName,
          component: componentName,
          field: `${field}.${subKey}`,
          oldValue: oldVal,
          newValue: newVal,
        });
      }
    }
  }

  return changes;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes a structured diff between two config objects.
 *
 * When oldConfig is null (fresh generation), every project and component
 * in newConfig is reported as an "add".
 *
 * @param {object|null} oldConfig — the previous configuration (or null)
 * @param {object}      newConfig — the proposed configuration
 * @returns {Array<object>} array of typed change objects
 */
export function diffConfigs(oldConfig, newConfig) {
  const changes = [];

  const oldIndex = oldConfig ? indexConfig(oldConfig) : new Map();
  const newIndex = indexConfig(newConfig);

  // ── Detect added & modified projects/components ────────────────────────

  for (const [projectName, newEntry] of newIndex) {
    const oldEntry = oldIndex.get(projectName);

    if (!oldEntry) {
      // Entire project is new
      changes.push({ type: "add-project", project: projectName });
      for (const compName of newEntry.components.keys()) {
        changes.push({
          type: "add-component",
          project: projectName,
          component: compName,
        });
      }
      continue;
    }

    // Project exists in both — compare components
    for (const [compName, newComp] of newEntry.components) {
      const oldComp = oldEntry.components.get(compName);

      if (!oldComp) {
        changes.push({
          type: "add-component",
          project: projectName,
          component: compName,
        });
        continue;
      }

      // Component exists in both — field-level diff
      const fieldChanges = diffComponent(projectName, compName, oldComp, newComp);
      changes.push(...fieldChanges);
    }

    // Detect removed components
    for (const compName of oldEntry.components.keys()) {
      if (!newEntry.components.has(compName)) {
        changes.push({
          type: "remove-component",
          project: projectName,
          component: compName,
        });
      }
    }
  }

  // ── Detect removed projects ────────────────────────────────────────────

  for (const [projectName, oldEntry] of oldIndex) {
    if (!newIndex.has(projectName)) {
      changes.push({ type: "remove-project", project: projectName });
      for (const compName of oldEntry.components.keys()) {
        changes.push({
          type: "remove-component",
          project: projectName,
          component: compName,
        });
      }
    }
  }

  return changes;
}
