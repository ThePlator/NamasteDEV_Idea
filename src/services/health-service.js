
import { exec } from "child_process";

export const runHealthCheck = async (component, project) => {
  const healthCheck = component.healthCheck;

  if (!healthCheck) {
    console.log(
      `[Health] No health check configured for ${project.name}/${component.name}, skipping`
    );
    return true;
  }

  console.log(
    `[Health] Running health check for  ${project.name}/${component.name}...`
  );

  const { type, retries = 3, delay = 5000 } = healthCheck;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let healthy = false;

      switch (type) {
        case "http":
          
          
          healthy = await checkHttp(healthCheck);
          break;
        case "pm2":
          healthy = await checkPm2(healthCheck, component);
          break;
        case "command":
          healthy = await checkCommand(healthCheck, component, project);
          break;
        default:
          console.warn(`[Health] Unknown health check type: ${type}`);
          return true;
      }

      if (healthy) {
        console.log(`[Health] ✓ ${component.name} is healthy`);
        return true;
      }
    } catch (err) {
      console.log(
        `[Health] Attempt ${attempt}/${retries} failed: ${err.message}`
      );
    }

    if (attempt < retries) {
      console.log(`[Health] Retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }

  console.log(`[Health] ✗ ${component.name} failed health check`);
  return false;
};

const checkHttp = async ({ url, expectedStatus = 200, timeout = 10000 }) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.status === expectedStatus;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
};

const checkPm2 = ({ processName }, component) => {
  return new Promise((resolve) => {
    let command;

    if (component.mode === "remote") {
      const { user, host, keyPath, port = 22 } = component.ssh;
      
      command = `ssh -i "${keyPath}" -p ${port} -o StrictHostKeyChecking=no ${user}@${host} "pm2 show ${processName} | grep online"`;
    } else {
      
      command = `pm2 show ${processName} | grep online`;
    }

    exec(command, (err) => {
      
      
      resolve(!err);
    });
  });
};

const checkCommand = ({ command }, component, project) => {
  return new Promise((resolve) => {
    let fullCommand;
    let options = {};

    if (component.mode === "remote") {
      const { user, host, keyPath, port = 22, remotePath } = component.ssh;
      
      fullCommand = `ssh -i "${keyPath}" -p ${port} -o StrictHostKeyChecking=no ${user}@${host} "cd ${remotePath} && ${command}"`;
    } else {
      
      fullCommand = command;
      options.cwd = project.localPath;
    }

    exec(fullCommand, options, (err) => {
      
      resolve(!err);
    });
  });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
