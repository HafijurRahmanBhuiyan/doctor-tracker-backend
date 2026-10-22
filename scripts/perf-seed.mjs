import "dotenv/config";
import mongoose from "mongoose";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Doctor = require("../dist/models/Doctor.js").default;
const Patient = require("../dist/models/Patient.js").default;
const tokens = (...values) => [...new Set(values.flatMap((value) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []))];

function perfUriFromEnv() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  const uri = new URL(process.env.MONGO_URI);
  uri.pathname = "/doctor-tracker-perf";
  const targetName = decodeURIComponent(uri.pathname.slice(1).split("/")[0]);
  if (targetName !== "doctor-tracker-perf") {
    throw new Error(`Refusing to run against database ${targetName}`);
  }
  return { uri: uri.toString(), targetName };
}

const { uri, targetName } = perfUriFromEnv();
let connected = false;
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  connected = true;
  if (mongoose.connection.name !== "doctor-tracker-perf") {
    throw new Error(`Connected to unexpected database: ${mongoose.connection.name}`);
  }
  // This script owns only the explicitly named throwaway database.
  await mongoose.connection.dropDatabase();
  await Promise.all([Doctor.syncIndexes(), Patient.syncIndexes()]);

  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const specializations = ["Cardiology", "Dermatology", "Neurology", "Pediatrics", "Orthopedics", "Oncology", "Psychiatry", "Radiology", "Ophthalmology", "Internal Medicine", "Surgery", "Allergy and Immunology"];
  const hospitals = ["Central Hospital", "Riverside Clinic", "North Medical Center", "City Health", "Westside Hospital", "Atlantic Medical Center", "St. Anne's Hospital"];
  const doctors = Array.from({ length: 500 }, (_, i) => {
    const createdAt = new Date(now.getTime() - ((i * 17) % 365) * day - (i % 24) * 3600000);
    return {
      name: `Doctor ${String(i).padStart(4, "0")}`,
      specialization: specializations[i % specializations.length],
      hospital: hospitals[i % hospitals.length],
      phone: `+1-555-${String(i).padStart(7, "0")}`,
      email: `doctor${String(i).padStart(4, "0")}@perf.example`,
      searchTokens: tokens(`Doctor ${String(i).padStart(4, "0")}`, `doctor${String(i).padStart(4, "0")}@perf.example`, `+1-555-${String(i).padStart(7, "0")}`, specializations[i % specializations.length], hospitals[i % hospitals.length]),
      createdAt,
      updatedAt: createdAt,
    };
  });
  for (let start = 0; start < doctors.length; start += 500) {
    await Doctor.insertMany(doctors.slice(start, start + 500), { ordered: true });
  }
  const doctorIds = await Doctor.find({}, { _id: 1 }).sort({ email: 1 }).lean();
  const conditions = ["Hypertension", "Asthma", "Diabetes", "Migraine", "Arthritis", "Anxiety", "Allergy", "Back pain", "Insomnia", "Thyroid disorder", "Heart disease", "Eczema", "Sinusitis", "Metabolic syndrome"];
  for (let start = 0; start < 30000; start += 1000) {
    const end = Math.min(start + 1000, 30000);
    const batch = Array.from({ length: end - start }, (_, offset) => {
      const i = start + offset;
      const createdAt = new Date(now.getTime() - ((i * 37) % 365) * day - (i % 86400) * 1000);
      return {
        name: `Patient ${String(i).padStart(5, "0")}`,
        age: i % 131,
        gender: ["male", "female", "other"][i % 3],
        phone: `+1-444-${String(i).padStart(7, "0")}`,
        email: `patient${String(i).padStart(5, "0")}@perf.example`,
        condition: conditions[i % conditions.length],
        searchTokens: tokens(`Patient ${String(i).padStart(5, "0")}`, `patient${String(i).padStart(5, "0")}@perf.example`, `+1-444-${String(i).padStart(7, "0")}`, conditions[i % conditions.length]),
        notes: `Routine follow-up number ${i}`,
        doctor: doctorIds[i % doctorIds.length]._id,
        createdAt,
        updatedAt: createdAt,
      };
    });
    await Patient.insertMany(batch, { ordered: true });
  }
  console.log(`Seeded ${await Doctor.countDocuments()} doctors and ${await Patient.countDocuments()} patients in ${targetName}.`);
} catch (error) {
  if (connected && mongoose.connection.name === "doctor-tracker-perf") {
    await mongoose.connection.dropDatabase().catch(() => undefined);
  }
  throw error;
} finally {
  if (connected) await mongoose.disconnect();
}
