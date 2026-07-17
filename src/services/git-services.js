
import fs from "node:fs";
import path from "path";

import { CICDError } from "../utils/cicd-error.js";
import { run } from "./deploy-service.js";

export const syncRepo = async (project, clone_url) => {

  
  try {
    fs.mkdirSync(project.localPath, { recursive: true });
    fs.accessSync(project.localPath, fs.constants.W_OK);
  } catch (err) {
    throw new CICDError({
      stage: "workspace-permission",
      project: project.name,
      originalError: `No write access to localPath: ${project.localPath}`,
    });
  }

  
  const gitDir = path.join(project.localPath, ".git");
  if (!fs.existsSync(gitDir)) {
    await run(
      `git clone -b ${project.branch} ${clone_url} ${project.localPath}`,
      undefined,
      {
        stage: "git-clone",
        project: project.name,
      }
    );
    return;
  }

  
  const remote = await run(
    `git config --get remote.origin.url`,
    project.localPath,
    {
      stage: "git-remote-check",
      project: project.name,
    }
  );

  if (!remote.includes(project.repository)) {
    throw new CICDError({
      stage: "sync-repository",
      project: project.name,
      originalError: "Repository mismatch in localPath",
    });
  }

  
  await run(`git fetch origin`, project.localPath, {
    stage: "git-fetch",
    project: project.name,
  });

  
  await run(`git reset --hard origin/${project.branch}`, project.localPath, {
    stage: "git-reset",
    project: project.name,
  });

  
  await run(`git clean -fd`, project.localPath, {
    stage: "git-clean",
    project: project.name,
  });
};
