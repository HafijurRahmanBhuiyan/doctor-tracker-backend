import mongoose from "mongoose";
import Doctor from "../models/Doctor";
import Patient from "../models/Patient";
import { config } from "../config/config";

// ---------- realistic BD data ----------
const specializations = [
  "Cardiology",
  "Neurology",
  "Orthopedics",
  "Pediatrics",
  "Dermatology",
  "Gynecology",
  "ENT",
  "Oncology",
];

const hospitals = [
  "Square Hospitals, Dhaka",
  "United Hospital, Dhaka",
  "Evercare Hospital, Dhaka",
  "Apollo Hospitals, Dhaka",
  "LabAID Specialized Hospital, Dhaka",
  "Ibrahim Cardiac Hospital, Dhaka",
  "Popular Diagnostic Centre, Dhaka",
  "Ibn Sina Medical College Hospital, Dhaka",
  "Holy Family Red Crescent Medical College Hospital, Dhaka",
  "Dhaka Medical College Hospital",
  "Bangabandhu Sheikh Mujib Medical University Hospital",
  "National Heart Foundation Hospital, Dhaka",
  "Metropolitan Hospital, Dhaka",
  "Moon Institute of Cardiology, Dhaka",
  "Dhaka Shishu Hospital",
];

const doctorNames = [
  "Dr. Ayesha Rahman",
  "Dr. Tanvir Ahmed",
  "Dr. Nusrat Jahan",
  "Dr. Kamrul Hasan",
  "Dr. Farhana Islam",
  "Dr. Imran Chowdhury",
  "Dr. Sadia Afrin",
  "Dr. Rubel Mahmud",
  "Dr. Shahnaz Parvin",
  "Dr. Abdul Karim",
  "Dr. Rumana Akter",
  "Dr. Jahangir Alam",
  "Dr. Sabina Yeasmin",
  "Dr. Mizanur Rahman",
  "Dr. Tasnim Haque",
];

const firstNames = [
  "Rahim",
  "Karim",
  "Fatema",
  "Ayesha",
  "Rafiq",
  "Salma",
  "Jahid",
  "Nasrin",
  "Shakil",
  "Rumana",
  "Anwar",
  "Sabina",
  "Mizan",
  "Tania",
  "Faruk",
  "Hasina",
  "Sohel",
  "Rina",
  "Imran",
  "Priya",
  "Alam",
  "Shirin",
  "Bashir",
  "Lipi",
  "Kamal",
  "Rima",
  "Sohag",
  "Momena",
  "Jasim",
  "Tanvir",
];

const lastNames = [
  "Hossain",
  "Ahmed",
  "Islam",
  "Rahman",
  "Chowdhury",
  "Akter",
  "Uddin",
  "Khan",
  "Sultana",
  "Begum",
  "Sheikh",
  "Miah",
  "Sarker",
  "Dewan",
  "Talukder",
];

const conditionsBySpec: Record<string, string[]> = {
  Cardiology: ["Hypertension", "Arrhythmia", "Heart Failure", "Angina"],
  Neurology: ["Migraine", "Epilepsy", "Stroke Recovery", "Neuropathy"],
  Orthopedics: ["Fracture", "Arthritis", "Back Pain", "Knee Injury"],
  Pediatrics: ["Fever", "Asthma", "Growth Concern", "Infection"],
  Dermatology: ["Eczema", "Psoriasis", "Acne", "Allergy"],
  Gynecology: ["PCOS", "Anemia", "Pregnancy Care", "Fibroid"],
  ENT: ["Sinusitis", "Tinnitus", "Hearing Loss", "Throat Infection"],
  Oncology: ["Breast Cancer", "Leukemia", "Chemotherapy Care", "Tumor Review"],
};

// uneven patient distribution across the 15 doctors (sum ~150)
const patientCounts = [18, 15, 14, 13, 12, 11, 11, 10, 9, 8, 7, 6, 6, 5, 5];

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function buildDoctors() {
  const usedEmails = new Set<string>();
  return doctorNames.map((name, i) => {
    const spec = specializations[i % specializations.length];
    const baseEmail = name
      .replace(/^Dr\.\s*/, "")
      .toLowerCase()
      .replace(/\s+/g, ".");
    let email = `${baseEmail}@example.com`;
    let n = 1;
    while (usedEmails.has(email)) {
      email = `${baseEmail}${n}@example.com`;
      n++;
    }
    usedEmails.add(email);
    const createdAt = daysAgo(rand(0, 179)); // spread over last ~6 months
    return {
      name,
      specialization: spec,
      hospital: hospitals[i % hospitals.length],
      phone: `01${rand(100000000, 999999999)}`,
      email,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function buildPatients(doctors: any[]) {
  const patients: any[] = [];
  doctors.forEach((doc, i) => {
    const count = patientCounts[i] ?? 5;
    const conds = conditionsBySpec[doc.specialization] ?? ["General Checkup"];
    for (let j = 0; j < count; j++) {
      const firstName = pick(firstNames);
      const lastName = pick(lastNames);
      const age = doc.specialization === "Pediatrics" ? rand(1, 15) : rand(16, 80);
      const gender = pick(["male", "female", "other"] as const);
      const createdAt = daysAgo(rand(0, 89)); // spread over last 90 days
      patients.push({
        name: `${firstName} ${lastName}`,
        age,
        gender,
        phone: `01${rand(100000000, 999999999)}`,
        email: Math.random() > 0.3 ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(1, 999)}@example.com` : undefined,
        condition: pick(conds),
        notes: Math.random() > 0.7 ? "Follow-up recommended" : undefined,
        doctor: doc._id,
        createdAt,
        updatedAt: createdAt,
      });
    }
  });
  return patients;
}

export const seedDemo = async (force: boolean = false): Promise<"seeded" | "skipped"> => {
  const existingDoctors = await Doctor.countDocuments();
  if (existingDoctors > 0 && !force) {
    console.log("Doctors already exist, skipping demo seed. Use --force to reseed.");
    return "skipped";
  }

  if (force) {
    await Doctor.deleteMany({});
    await Patient.deleteMany({});
    console.log("Force flag: deleted all doctors and patients (users untouched).");
  }

  const doctorsData = buildDoctors();
  const doctors = await Doctor.insertMany(doctorsData, { timestamps: false });
  const patientsData = buildPatients(doctors);
  await Patient.insertMany(patientsData, { timestamps: false });

  console.log(`Seeded ${doctors.length} doctors and ${patientsData.length} patients.`);
  return "seeded";
};

// CLI entrypoint
if (require.main === module) {
  const force = process.argv.includes("--force");
  mongoose
    .connect(config.MONGO_URI)
    .then(async () => {
      await seedDemo(force);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
