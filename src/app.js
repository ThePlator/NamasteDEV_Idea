
import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import healthRoutes from "./routes/health.js";
import webhookRoutes from "./routes/webhook.js";
import runsRoutes from "./routes/runs.js";
import configRoutes from "./routes/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve static files from public/
app.use(express.static(join(__dirname, "..", "public")));

app.use(healthRoutes);
app.use(webhookRoutes);
app.use(runsRoutes);
app.use(configRoutes);

app.listen(PORT, () => console.log(`CI/CD Server is running on PORT ${PORT}`));

