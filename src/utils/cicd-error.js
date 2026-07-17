
export class CICDError extends Error {
  constructor({ stage, project, component, command, originalError }) {
    super(originalError?.toString() || "CI/CD Error");

    this.stage = stage; 
    this.project = project;
    this.component = component;
    this.command = command;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }
}
