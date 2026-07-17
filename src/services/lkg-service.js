

import fs from "node:fs";
import path from "node:path";

const LKG_FILE = path.join(import.meta.dirname, "..", "store", "lkg.json");

const readStore = () => {
  try {
    if (!fs.existsSync(LKG_FILE)) return {};
    const data = fs.readFileSync(LKG_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
};

const writeStore = (data) => {
  const dir = path.dirname(LKG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LKG_FILE, JSON.stringify(data, null, 2));
};

export const getLKG = (projectName, componentName) => {
  const store = readStore();
  return store[projectName]?.[componentName] || null;
};

export const saveLKG = (projectName, componentName, sha) => {
  const store = readStore();

  if (!store[projectName]) store[projectName] = {};

  store[projectName][componentName] = {
    sha,
    deployedAt: new Date().toISOString(),
    verifiedHealthy: true,
  };

  writeStore(store);
  console.log(
    `[LKG] Saved ${projectName}/${componentName} → ${sha.slice(0, 7)}`
  );
};

export const getAllLKG = () => readStore();
