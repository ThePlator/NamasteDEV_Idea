
import crypto from "crypto";

const GITHUB_SECRET = process.env.GITHUB_SECRET;

export const verifySignature = (req, res, next) => {
  
  const originalSignature = req.headers["x-hub-signature-256"];
  if (!originalSignature) return res.status(401).send("Invalid signature");

  
  const generatedSignature =
    "sha256=" +
    crypto
      .createHmac("sha256", GITHUB_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");

  
  const buf1 = Buffer.from(generatedSignature);
  const buf2 = Buffer.from(originalSignature);

  if (buf1.length !== buf2.length) {
    return res.status(401).send("Invalid signature");
  }

  
  if (!crypto.timingSafeEqual(buf1, buf2)) {
    return res.status(401).send("Invalid Signature");
  }

  next();
};
