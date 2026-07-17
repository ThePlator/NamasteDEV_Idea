
import { exec } from "child_process";
import fs from "node:fs";
import os from "node:os";

import { run } from "./deploy-service.js";
import { CICDError } from "../utils/cicd-error.js";

export const runSSHCommands = async (
  project,
  component,
  commands,
  context = {}
) => {
  const ssh = component.ssh;
  if (!ssh) {
    throw new CICDError({
      stage: "ssh-config",
      project: project.name,
      component: component.name,
      originalError: "SSH config missing for ssh mode",
    });
  }

  
  const { host, user, port = 22, remotePath, keyPath } = ssh;
  if (!host || !user || !remotePath) {
    throw new CICDError({
      stage: "ssh-config",
      project: project.name,
      component: component.name,
      originalError:
        "ssh.host, ssh.user, ssh.remotePath and ssh.keyPath are required",
    });
  }

  
  if (!keyPath || !fs.existsSync(keyPath)) {
    throw new CICDError({
      stage: "ssh-key",
      project: project.name,
      component: component.name,
      originalError: `SSH key not found at path: ${keyPath}`,
    });
  }

  
  if (os.platform() !== "win32") {
    const stat = fs.statSync(keyPath);
    if ((stat.mode & 0o077) !== 0) {
      throw new CICDError({
        stage: "ssh-key",
        project: project.name,
        component: component.name,
        originalError: "SSH key permissions too open. Use chmod 600",
      });
    }
  }

  
  await run(
    [
      "ssh",
      `-i "${keyPath}"`,
      `-p ${port}`,
      "-o BatchMode=yes",
      "-o ConnectTimeout=10",
      "-o StrictHostKeyChecking=no",
      `${user}@${host}`,
      `"echo SSH_OK"`,
    ].join(" "),
    undefined,
    {
      stage: "ssh-preflight",
      project: project.name,
      component: component.name,
    }
  );

  
  const envPrefix = buildEnvPrefix(context.env || []);
  for (const command of commands) {
    
    const remoteCmd = `${envPrefix} cd "${remotePath}" && ${command}`;
    const escaped = remoteCmd.replace(/'/g, `'\\''`);

    // Full SSH command to be executed locally
    const sshCommand = [
      "ssh",
      "-o BatchMode=yes", // Disable password prompts
      "-o StrictHostKeyChecking=no", // Disable host key checking
      "-o UserKnownHostsFile=/dev/null", // Do not store host keys
      `-i "${keyPath}"`,
      `-p ${port}`,
      `${user}@${host}`,
      `"bash -lc '${escaped}'"`, // Use bash login shell on remote side for proper env loading
    ].join(" ");

    await runSSH(sshCommand, undefined, {
      stage: "ssh-deploy",
      project: project.name,
      component: component.name,
    });
  }
};

/**
 * Builds a string of environment variable assignments
 * @param {Array} keys - List of environment variable keys
 * @returns {string} - Environment variable assignments as a string
 */
const buildEnvPrefix = (keys = []) => {
  return keys
    .map((key) => {
      const value = process.env[key];
      return `${key}='${value.replace(/'/g, `'\\''`)}'`;
    })
    .join(" ");
};

/**
 * Runs an SSH command
 * @param {string} sshCommand - The full SSH command to execute
 * @param {string} cwd - The current working directory
 * @param {Object} context - Context information for error handling
 * @returns {Promise<string>} - Resolves with command output or rejects with error
 */
const runSSH = (sshCommand, cwd, context) => {
  return new Promise((resolve, reject) => {
    exec(sshCommand, { cwd }, (err, stdout, stderr) => {
      if (err) {
        return reject(
          new CICDError({
            ...context,
            command: sshCommand,
            originalError: stderr || err.message,
          })
        );
      }

      if (stdout) console.log(stdout.trim());
      if (stderr) console.error(stderr.trim());

      resolve(stdout?.trim());
    });
  });
};
