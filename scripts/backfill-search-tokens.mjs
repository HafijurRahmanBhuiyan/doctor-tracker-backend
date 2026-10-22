import "dotenv/config";
import mongoose from "mongoose";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { backfillSearchTokens } = require("../dist/utils/searchTokenBackfill.js");

if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
const uri = new URL(process.env.MONGO_URI);
const databaseName = decodeURIComponent(uri.pathname.slice(1).split("/")[0]);
if (databaseName !== "doctor-tracker") {
  throw new Error(`Refusing to run against ${databaseName}; expected doctor-tracker`);
}

await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 5000 });
try {
  if (mongoose.connection.name !== "doctor-tracker") {
    throw new Error(`Refusing connected database ${mongoose.connection.name}`);
  }
  const result = await backfillSearchTokens();
  const total = result.doctors + result.patients;
  if (total) console.log(`Backfilled search tokens for ${result.doctors} doctors and ${result.patients} patients`);
  else console.log("No documents needed search-token backfill.");
} finally {
  await mongoose.disconnect();
}
