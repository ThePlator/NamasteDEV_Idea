import express from "express";
import { runs } from "../store/runs.js";

const router = express.Router();

router.get("/runs/:commitSha", (req, res) => {
  const run = runs.get(req.params.commitSha);

  if (!run) {
    return res.status(404).json({
      success: false,
      message: "Run not found",
    });
  }

  res.status(200).json({
    success: true,
    ...run,
  });
});

export default router;
