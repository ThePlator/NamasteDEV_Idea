/**
 * config.js — Express router for CI/CD config management endpoints.
 *
 * POST /config/generate — generate a config from natural-language instruction
 * POST /config/apply    — validate and write a proposed config to disk
 */

import express from "express";
import rateLimit from "express-rate-limit";
import { generateConfig } from "../services/config-ai-service.js";
import { diffConfigs } from "../services/config-diff-service.js";
import { validateConfig } from "../services/config-validator.js";
import { readConfig, writeConfig } from "../services/config-writer-service.js";

const router = express.Router();

// ── Rate limiter for /config/generate (paid API calls) ───────────────────────

const generateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,                  // 10 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message:
        "Too many generate requests — limit is 10 per 5 minutes. Please wait and try again.",
    });
  },
});

// ── POST /config/generate ────────────────────────────────────────────────────

router.post("/config/generate", generateLimiter, async (req, res) => {
  const { instruction } = req.body || {};

  if (!instruction || typeof instruction !== "string") {
    return res.status(400).json({
      success: false,
      message: "Missing or invalid 'instruction' in request body.",
    });
  }

  try {
    const currentConfig = readConfig();
    const proposedConfig = await generateConfig(instruction, currentConfig);
    const diff = diffConfigs(currentConfig, proposedConfig);

    res.json({ success: true, proposedConfig, diff });
  } catch (err) {
    res.status(422).json({
      success: false,
      message: err.message,
      details: err.details || null,
    });
  }
});

// ── POST /config/apply ───────────────────────────────────────────────────────

router.post("/config/apply", (req, res) => {
  const { proposedConfig } = req.body || {};

  if (!proposedConfig || typeof proposedConfig !== "object") {
    return res.status(400).json({
      success: false,
      message: "Missing or invalid 'proposedConfig' in request body.",
    });
  }

  // Re-validate server-side — never trust the client blindly
  const { valid, errors } = validateConfig(proposedConfig);

  if (!valid) {
    return res.status(422).json({
      success: false,
      message: "Proposed config does not match the schema.",
      errors,
    });
  }

  // Safety check: refuse to silently delete existing projects
  const currentConfig = readConfig();
  if (currentConfig && currentConfig.projects) {
    const proposedNames = new Set(
      (proposedConfig.projects || []).map((p) => p.name)
    );
    const deletedProjects = currentConfig.projects
      .map((p) => p.name)
      .filter((name) => !proposedNames.has(name));

    if (deletedProjects.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          `This would delete existing project(s): ${JSON.stringify(deletedProjects)}. ` +
          "Refusing to apply. If this is intentional, remove them manually " +
          "or extend the API to support explicit confirmed deletions.",
      });
    }

    // Safety check: refuse to silently drop top-level keys from existing projects/components
    const proposedByName = Object.fromEntries(
      (proposedConfig.projects || []).map((p) => [p.name, p])
    );
    const fieldLossDetails = [];

    for (const curProject of currentConfig.projects) {
      const propProject = proposedByName[curProject.name];
      if (!propProject) continue; // already caught by deleted-projects check

      // Check project-level keys
      const curProjectKeys = Object.keys(curProject).filter((k) => k !== "components");
      const propProjectKeys = new Set(Object.keys(propProject).filter((k) => k !== "components"));
      const missingProjectKeys = curProjectKeys.filter((k) => !propProjectKeys.has(k));
      if (missingProjectKeys.length > 0) {
        fieldLossDetails.push({
          project: curProject.name,
          component: null,
          missingFields: missingProjectKeys,
        });
      }

      // Check component-level keys
      if (Array.isArray(curProject.components) && Array.isArray(propProject.components)) {
        const propComponentsByName = Object.fromEntries(
          propProject.components.map((c) => [c.name, c])
        );
        for (const curComp of curProject.components) {
          const propComp = propComponentsByName[curComp.name];
          if (!propComp) continue; // component removed — different concern
          const curCompKeys = Object.keys(curComp);
          const propCompKeys = new Set(Object.keys(propComp));
          const missingCompKeys = curCompKeys.filter((k) => !propCompKeys.has(k));
          if (missingCompKeys.length > 0) {
            fieldLossDetails.push({
              project: curProject.name,
              component: curComp.name,
              missingFields: missingCompKeys,
            });
          }
        }
      }
    }

    if (fieldLossDetails.length > 0) {
      const summary = fieldLossDetails
        .map((d) => {
          const loc = d.component
            ? `${d.project}/${d.component}`
            : d.project;
          return `${loc}: [${d.missingFields.join(", ")}]`;
        })
        .join("; ");
      return res.status(409).json({
        success: false,
        message: `This would remove existing field(s): ${summary}`,
        details: fieldLossDetails,
      });
    }
  }

  try {
    const { backupPath } = writeConfig(proposedConfig);
    res.json({
      success: true,
      message: "Config updated",
      backupPath,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to write config: ${err.message}`,
    });
  }
});

export default router;
