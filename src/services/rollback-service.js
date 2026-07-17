
import path from "path";

import { run } from "./deploy-service.js";
import { getLKG } from "./lkg-service.js";
import { runSSHCommands } from "./ssh-service.js";
import { sendTelegramRollback } from "./telegram-service.js";

export const rollbackToLKG = async (project, component) => {
  const lkg = getLKG(project.name, component.name);

  if (!lkg) {
    console.error(
      `[Rollback] No LKG found for ${project.name}/${component.name}`
    );
    console.error(`[Rollback] Manual intervention required!`);
    await sendTelegramRollback({
      project: project.name,
      component: component.name,
      lkgSha: null,
      lkgDeployedAt: null,
      success: false,
      errorMessage: "No LKG found, manual intervention required",
    });
    return false;
  }

  console.log(
    `[Rollback] Rolling back ${component.name} to LKG: ${lkg.sha.slice(0, 7)}`
  );
  console.log(`[Rollback] LKG was deployed at: ${lkg.deployedAt}`);

  try {
    if (component.mode === "local") {
      await rollbackLocal(project, component, lkg.sha);
    } else if (component.mode === "remote") {
      await rollbackRemote(project, component, lkg.sha);
    }

    console.log(`[Rollback] ✓ Successfully rolled back ${component.name}`);
    await sendTelegramRollback({
      project: project.name,
      component: component.name,
      lkgSha: lkg.sha.slice(0, 7),
      lkgDeployedAt: lkg.deployedAt,
      success: true,
    });
    return true;
  } catch (err) {
    console.error(`[Rollback] ✗ Rollback failed: ${err.message}`);
    await sendTelegramRollback({
      project: project.name,
      component: component.name,
      lkgSha: lkg.sha.slice(0, 7),
      lkgDeployedAt: lkg.deployedAt,
      success: false,
      errorMessage: err.message,
    });
    return false;
  }
};

const rollbackLocal = async (project, component, sha) => {
  const cwd = path.join(project.localPath, component.path || "");
  const { commands } = component;

  
  await run(`git reset --hard ${sha}`, cwd, {
    stage: "rollback-reset",
    project: project.name,
    component: component.name,
  });

  
  if (commands.install) {
    await run(commands.install, cwd, {
      stage: "rollback-install",
      project: project.name,
      component: component.name,
    });
  }

  
  if (commands.build) {
    await run(commands.build, cwd, {
      stage: "rollback-build",
      project: project.name,
      component: component.name,
    });
  }

  
  if (commands.deploy) {
    const deployCommands = Array.isArray(commands.deploy)
      ? commands.deploy
      : [commands.deploy];
    for (const cmd of deployCommands) {
      await run(cmd, cwd, {
        stage: "rollback-deploy",
        project: project.name,
        component: component.name,
      });
    }
  }
};

const rollbackRemote = async (project, component, sha) => {
  const { commands } = component;
  const rollbackCommands = [];

  
  
  rollbackCommands.push("git fetch --all");
  rollbackCommands.push(`git reset --hard ${sha}`);

  
  if (commands.install) {
    rollbackCommands.push(commands.install);
  }

  
  if (commands.build) {
    const buildCmds = Array.isArray(commands.build)
      ? commands.build
      : [commands.build];
    rollbackCommands.push(...buildCmds);
  }

  
  if (commands.deploy) {
    const deployCmds = Array.isArray(commands.deploy)
      ? commands.deploy
      : [commands.deploy];
    rollbackCommands.push(...deployCmds);
  }

  await runSSHCommands(project, component, rollbackCommands, {
    env: component.env || [],
  });
};
