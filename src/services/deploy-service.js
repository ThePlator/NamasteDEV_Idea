
import { exec } from "child_process";
import path from "path";
import fs from "node:fs";

import {
  componentChanged,
  dependenciesChanged,
  getChangedFiles,
} from "../utils/path-matcher.js";
import { validateEnv } from "../utils/validate-env.js";
import { CICDError } from "../utils/cicd-error.js";
import { sendTelegramAlert, sendTelegramSuccess } from "./telegram-service.js";
import { runSSHCommands } from "./ssh-service.js";
import { saveLKG } from "./lkg-service.js";
import { rollbackToLKG } from "./rollback-service.js";
import { runHealthCheck } from "./health-service.js";

export const processDeployment = async (project, commits, metadata) => {
  
  const files = getChangedFiles(commits);

  
  for (const component of project.components) {
    
    if (!componentChanged(component, files)) continue;

    if (!component.mode) {
      throw new CICDError({
        stage: "mode-detection",
        project: project.name,
        component: component.name,
        originalError: "component mode is required",
      });
    }

    
    if (component.env && component.env.length > 0) {
      validateEnv(component.env, {
        project: project.name,
        component: component.name,
      });
    }

    
    await deployComponent(component, project, files, metadata);
  }
};

const deployComponent = async (component, project, files, metadata) => {
  const componentId = `${project.name}/${component.name}`;

  try {
    console.log(`[Deploy] Starting deployment for ${componentId}`);

    
    if (component.mode === "local") {
      await runLocal(component, project, files);
    } else if (component.mode === "remote") {
      await runRemote(component, project, files);
    }

    
    const isHealthy = await runHealthCheck(component, project);

    if (!isHealthy) {
      throw new CICDError({
        stage: "health-check",
        project: project.name,
        component: component.name,
        originalError: "Health check failed after deployment, rollback initiated",
      });
    }

    
    const currentSha = await getCurrentSha(project, component);
    console.log(`[Deploy] Saving LKG for ${componentId}: ${currentSha}`);
    saveLKG(project.name, component.name, currentSha);

    
    await sendTelegramSuccess({
      project: project.name,
      component: component.name,
      commitMessage: metadata?.commitMessage,
      commitAuthor: metadata?.commitAuthor,
    });
  } catch (error) {
    console.error(`[Deploy] Failed: ${componentId} - ${error.message}`);

    
    await sendTelegramAlert(
      new CICDError({
        stage: "deployment-failure",
        project: project.name,
        component: component.name,
        originalError: error.message,
      })
    );

    
    const rollbackSuccess = await rollbackToLKG(project, component);

    if(rollbackSuccess) {
      error.message += " | Rollback succeeded";
    } else {
      error.message += " | Rollback failed, manual intervention required";
    }

    
    error.rollbackAttempted = true;
    error.rollbackSuccess = rollbackSuccess;
    throw error;
  }
};

const getCurrentSha = async (project, component) => {
  if (component.mode === "local") {
    return await run("git rev-parse HEAD", project.localPath, {
      stage: "get-sha",
      project: project.name,
    });
  } else {
    
    const ssh = component.ssh;
    
    const command = `ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
   -i "${ssh.keyPath}" -p 22 ${ssh.user}@${ssh.host} \
   'cd "${ssh.remotePath}" && git rev-parse HEAD'`;

    const result = await run(
      command,
      undefined,
      { stage: "get-sha", project: project.name }
    );

    return result.trim();
  }
};

const normalize = (cmd) => (Array.isArray(cmd) ? cmd : [cmd]);

const runCommands = async (commands, cwd, context) => {
  for (const command of normalize(commands)) {
    await run(command, cwd, context);
  }
};

export const run = (command, cwd, context) => {
  return new Promise((resolve, reject) => {
    exec(`bash -lc "${command}"`, { cwd }, (err, stdout, stderr) => {
      if (err) {
        return reject(
          new CICDError({
            ...context,
            command,
            originalError: stderr || err.message,
          })
        );
      }

      if (stdout) console.log(stdout.trim());
      resolve(stdout?.trim());
    });
  });
};

const runLocal = async (component, project, files) => {
  
  const componentCWD = path.join(project.localPath, component.path || "");

  if (!fs.existsSync(componentCWD)) {
    throw new CICDError({
      stage: "preflight",
      project: project.name,
      component: component.name,
      originalError: `Component path does not exist: ${componentCWD}`,
    });
  }

  const { commands } = component;

  
  const usesNode = ["install", "build", "test"].some(
    (step) =>
      commands[step] &&
      normalize(commands[step]).some((cmd) => cmd.trim().startsWith("npm "))
  );

  
  if (usesNode) {
    const pkgPath = path.join(componentCWD, "package.json");
    if (!fs.existsSync(pkgPath)) {
      throw new CICDError({
        stage: "preflight",
        project: project.name,
        component: component.name,
        originalError: `package.json not found at ${pkgPath}`,
      });
    }
  }

  
  const nodeModulesPath = path.join(componentCWD, "node_modules");

  
  const depsChanged =
    component.dependencyFiles.length > 0 &&
    dependenciesChanged(component, files);
  const needInstall = !fs.existsSync(nodeModulesPath) || depsChanged;

  if (needInstall && commands.install) {
    await run(commands.install, componentCWD, {
      stage: "install",
      project: project.name,
      component: component.name,
    });
  }

  if (commands.test) {
    await run(commands.test, componentCWD, {
      stage: "test",
      project: project.name,
      component: component.name,
    });
  }

  if (commands.build) {
    await run(commands.build, componentCWD, {
      stage: "build",
      project: project.name,
      component: component.name,
    });
  }

  if (commands.deploy) {
    await runCommands(commands.deploy, componentCWD, {
      stage: "deploy",
      project: project.name,
      component: component.name,
    });
  }
};

const runRemote = async (component, project, files) => {
  const { commands } = component;

  
  const depsChanged =
    component.dependencyFiles.length > 0 &&
    dependenciesChanged(component, files);

  const remoteCommands = [];

  if (commands.pull) {
    remoteCommands.push(...normalize(commands.pull));
  }

  if (commands.install) {
    if (depsChanged) {
      remoteCommands.push(commands.install);
    } else {
      
      remoteCommands.push(`[ -d node_modules ] || ${commands.install}`);
    }
  }

  if (commands.test) {
    remoteCommands.push(...normalize(commands.test));
  }

  if (commands.build) {
    remoteCommands.push(...normalize(commands.build));
  }

  if (commands.deploy) {
    remoteCommands.push(...normalize(commands.deploy));
  }

  
  await runSSHCommands(project, component, remoteCommands, {
    env: component.env || [],
  });
};
