
import "dotenv/config";
import express from "express";

import healthRoutes from "./routes/health.js";
import webhookRoutes from "./routes/webhook.js";
import runsRoutes from "./routes/runs.js";

const app = express();
const PORT = process.env.PORT;

app.use(express.json());

app.use(healthRoutes);
app.use(webhookRoutes);
app.use(runsRoutes);

app.listen(PORT, () => console.log(`CI/CD Server is running on PORT ${PORT}`));
