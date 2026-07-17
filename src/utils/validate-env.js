
import { CICDError } from "./cicd-error.js";

export const validateEnv = (required, context = {}) => {
  for (const key of required) {
    if (!process.env[key]) {
      throw new CICDError({
        stage: "env-validation",
        project: context.project,
        component: context.component,
        originalError: `Missing required env variable: ${key}`,
      });
    }
  }
};
