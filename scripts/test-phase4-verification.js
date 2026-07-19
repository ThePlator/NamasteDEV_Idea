#!/usr/bin/env node

/**
 * scripts/test-phase4-verification.js
 *
 * Comprehensive verification for the three Phase 4 fixes:
 *
 * TEST 1 — Schema validation: the real cicd-config.json (with healthCheck,
 *          env, build, dependencyFiles) passes schema validation.
 *
 * TEST 2 — AI generation: generate against the REAL config as currentConfig,
 *          confirm SmartKrishi & DevTinder survive with all extra fields intact.
 *
 * TEST 3 — Field-loss guardrail: POST a proposedConfig that's missing one
 *          extra field, confirm a 409 with field-level detail.
 *
 * Run:
 *   node --env-file=.env scripts/test-phase4-verification.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateConfig } from "../src/services/config-validator.js";
import { generateConfig } from "../src/services/config-ai-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const realConfigPath = join(__dirname, "..", "src", "config", "cicd-config.json");
const realConfig = JSON.parse(readFileSync(realConfigPath, "utf-8"));

let allPassed = true;

function pass(label) {
  console.log(`  ✅ PASS — ${label}`);
}

function fail(label, detail) {
  console.log(`  ❌ FAIL — ${label}`);
  if (detail) console.log(`           ${detail}`);
  allPassed = false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1 — Schema validation accepts the real config with extra fields
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══ TEST 1: Schema validation with extra fields ═══════════════\n");

const { valid, errors } = validateConfig(realConfig);
if (valid) {
  pass("Real cicd-config.json passes schema validation");
} else {
  fail(
    "Real cicd-config.json failed schema validation",
    JSON.stringify(errors, null, 2)
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2 — AI generation preserves real config fields
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══ TEST 2: AI generation preserves extra fields ══════════════\n");

const instruction = "add a staging environment for the SmartKrishi API";
console.log(`Instruction: "${instruction}"`);
console.log("(using real cicd-config.json as currentConfig)\n");

let proposed;
try {
  proposed = await generateConfig(instruction, realConfig);
  console.log("AI returned proposed config.\n");

  // 2a — Both projects still present
  const projectNames = proposed.projects.map((p) => p.name);
  if (projectNames.includes("SmartKrishi")) {
    pass("SmartKrishi project preserved");
  } else {
    fail("SmartKrishi project MISSING from proposed config");
  }
  if (projectNames.includes("DevTinder")) {
    pass("DevTinder project preserved");
  } else {
    fail("DevTinder project MISSING from proposed config");
  }

  // 2b — Check extra fields survived on SmartKrishi components
  const smartKrishi = proposed.projects.find((p) => p.name === "SmartKrishi");
  if (smartKrishi) {
    // Check localPath on project level
    if (smartKrishi.localPath) {
      pass(`SmartKrishi.localPath preserved: "${smartKrishi.localPath}"`);
    } else {
      fail("SmartKrishi.localPath MISSING");
    }

    for (const comp of smartKrishi.components || []) {
      const prefix = `SmartKrishi/${comp.name}`;

      // Only check components that existed in the original
      const originalComp = realConfig.projects
        .find((p) => p.name === "SmartKrishi")
        ?.components?.find((c) => c.name === comp.name);
      if (!originalComp) continue; // new component added by AI, skip

      if (originalComp.healthCheck) {
        if (comp.healthCheck) {
          pass(`${prefix}.healthCheck preserved`);
        } else {
          fail(`${prefix}.healthCheck MISSING`);
        }
      }
      if (originalComp.dependencyFiles) {
        if (comp.dependencyFiles) {
          pass(`${prefix}.dependencyFiles preserved`);
        } else {
          fail(`${prefix}.dependencyFiles MISSING`);
        }
      }
      if (originalComp.env) {
        if (comp.env) {
          pass(`${prefix}.env preserved`);
        } else {
          fail(`${prefix}.env MISSING`);
        }
      }
      // Check build command in commands if original had it
      if (originalComp.commands?.build) {
        if (comp.commands?.build) {
          pass(`${prefix}.commands.build preserved`);
        } else {
          fail(`${prefix}.commands.build MISSING`);
        }
      }
    }
  }

  // 2c — Check DevTinder extra fields
  const devTinder = proposed.projects.find((p) => p.name === "DevTinder");
  if (devTinder) {
    if (devTinder.localPath) {
      pass(`DevTinder.localPath preserved: "${devTinder.localPath}"`);
    } else {
      fail("DevTinder.localPath MISSING");
    }

    const apiServer = devTinder.components?.find((c) => c.name === "API-Server");
    if (apiServer) {
      if (apiServer.healthCheck) {
        pass("DevTinder/API-Server.healthCheck preserved");
      } else {
        fail("DevTinder/API-Server.healthCheck MISSING");
      }
      if (apiServer.env) {
        pass("DevTinder/API-Server.env preserved");
      } else {
        fail("DevTinder/API-Server.env MISSING");
      }
      if (apiServer.dependencyFiles) {
        pass("DevTinder/API-Server.dependencyFiles preserved");
      } else {
        fail("DevTinder/API-Server.dependencyFiles MISSING");
      }
    }
  }

  // Print the full proposed config for reference
  console.log("\n  Full proposed config:");
  console.log(JSON.stringify(proposed, null, 2).split("\n").map(l => "    " + l).join("\n"));

} catch (err) {
  fail("AI generation threw an error", err.message);
  if (err.details) console.log("  Details:", err.details);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3 — Field-loss guardrail on /config/apply
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══ TEST 3: Field-loss guardrail (409 on missing fields) ══════\n");

// Build a deliberately defective proposedConfig: copy real config but strip
// healthCheck from SmartKrishi/Backend-API and env from DevTinder/API-Server
const defective = JSON.parse(JSON.stringify(realConfig));
const skBackend = defective.projects
  .find((p) => p.name === "SmartKrishi")
  ?.components?.find((c) => c.name === "Backend-API");
if (skBackend) {
  delete skBackend.healthCheck;
  console.log("Stripped healthCheck from SmartKrishi/Backend-API");
}
const dtApi = defective.projects
  .find((p) => p.name === "DevTinder")
  ?.components?.find((c) => c.name === "API-Server");
if (dtApi) {
  delete dtApi.env;
  console.log("Stripped env from DevTinder/API-Server");
}

// Start the server temporarily to test the endpoint
console.log("\nStarting server on port 39876 for apply test...\n");

// We import app setup inline to avoid conflicting with running server
import express from "express";
import configRoutes from "../src/routes/config.js";

const app = express();
app.use(express.json());
app.use(configRoutes);

const server = await new Promise((resolve) => {
  const s = app.listen(39876, () => resolve(s));
});

try {
  const res = await fetch("http://localhost:39876/config/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposedConfig: defective }),
  });

  const data = await res.json();

  console.log(`Response status: ${res.status}`);
  console.log(`Response body: ${JSON.stringify(data, null, 2)}\n`);

  if (res.status === 409) {
    pass("Got 409 status (apply rejected)");
  } else {
    fail(`Expected 409 but got ${res.status}`);
  }

  if (data.message && data.message.includes("remove existing field")) {
    pass(`Message mentions field removal: "${data.message}"`);
  } else {
    fail("Message doesn't mention field removal");
  }

  if (Array.isArray(data.details) && data.details.length > 0) {
    pass(`Got ${data.details.length} detail(s) about field loss`);
    for (const d of data.details) {
      console.log(
        `    → ${d.project}${d.component ? "/" + d.component : ""}: missing [${d.missingFields.join(", ")}]`
      );
    }
  } else {
    fail("No field-loss details in response");
  }

  // Verify the real config was NOT overwritten
  const configAfter = JSON.parse(readFileSync(realConfigPath, "utf-8"));
  const skBackendAfter = configAfter.projects
    .find((p) => p.name === "SmartKrishi")
    ?.components?.find((c) => c.name === "Backend-API");
  if (skBackendAfter?.healthCheck) {
    pass("Real config on disk was NOT modified (healthCheck still present)");
  } else {
    fail("Real config on disk was modified — healthCheck is gone!");
  }
} finally {
  server.close();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
if (allPassed) {
  console.log("🎉 ALL CHECKS PASSED");
} else {
  console.log("⚠️  SOME CHECKS FAILED — review output above");
  process.exit(1);
}
console.log("═══════════════════════════════════════════════════════════════\n");
