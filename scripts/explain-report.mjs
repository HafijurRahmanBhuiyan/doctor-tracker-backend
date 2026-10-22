import "dotenv/config";
import mongoose from "mongoose";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Doctor = require("../dist/models/Doctor.js").default;
const Patient = require("../dist/models/Patient.js").default;
const tokenPatterns = (value) => [...new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].map((token) => new RegExp(`^${token}`));

function perfUriFromEnv() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  const uri = new URL(process.env.MONGO_URI);
  uri.pathname = "/doctor-tracker-perf";
  const targetName = decodeURIComponent(uri.pathname.slice(1).split("/")[0]);
  if (targetName !== "doctor-tracker-perf") throw new Error(`Refusing database ${targetName}`);
  return { uri: uri.toString(), targetName };
}

function findStages(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.stage) out.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => findStages(child, out));
    else if (value && typeof value === "object") findStages(value, out);
  }
  return out;
}

function resultMetrics(explain) {
  const candidates = [];
  const collect = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.executionStats) candidates.push(node.executionStats);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") collect(value);
    }
  };
  collect(explain);
  const stats = candidates.sort((a, b) => (b.totalDocsExamined ?? 0) - (a.totalDocsExamined ?? 0))[0] ?? explain.executionStats ?? {};
  const stages = findStages({
    plan: explain.queryPlanner?.winningPlan ?? {},
    execution: stats.executionStages ?? {},
    aggregation: explain.stages ?? [],
  });
  const indexes = [...new Set(stages.filter((stage) => stage.stage === "IXSCAN" || stage.stage === "COUNT_SCAN").map((stage) => stage.indexName).filter(Boolean))];
  const stageNames = [...new Set(stages.map((stage) => stage.stage))];
  const docs = stats.totalDocsExamined ?? 0;
  const returned = stats.nReturned ?? 0;
  const hasBlockingSort = stages.some((stage) => stage.stage === "SORT");
  const hasCollectionScan = stageNames.includes("COLLSCAN");
  const flag = hasCollectionScan || docs > Math.max(returned, 1) * 10 || (hasBlockingSort && returned >= 1000);
  return {
    stage: stageNames.join(" → ") || "UNKNOWN",
    index: indexes.join(", ") || "—",
    docs,
    returned,
    millis: stats.executionTimeMillis ?? 0,
    sort: hasBlockingSort ? "yes" : "no",
    flag,
  };
}

const { uri, targetName } = perfUriFromEnv();
let connected = false;
const reports = [];
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  connected = true;
  if (mongoose.connection.name !== "doctor-tracker-perf") throw new Error(`Refusing connected database ${mongoose.connection.name}`);
  const DoctorModel = Doctor;
  const PatientModel = Patient;
  const doctor = await DoctorModel.findOne({ email: "doctor0000@perf.example" }).lean();
  const selectivePatient = await PatientModel.findOne({ name: "Patient 29999" }).lean();
  if (!doctor || !selectivePatient) throw new Error("Performance fixture missing; run perf-seed.mjs first");
  const doctorsInListPage = await DoctorModel.find({}, { _id: 1 }).sort({ createdAt: -1 }).limit(50).lean();
  const dateFrom = new Date(Date.now() - 30 * 86400000);
  const dateTo = new Date();
  const last7From = new Date(Date.now() - 6 * 86400000);
  const last30From = new Date(Date.now() - 29 * 86400000);
  const sixMonthsFrom = new Date();
  sixMonthsFrom.setMonth(sixMonthsFrom.getMonth() - 5);
  sixMonthsFrom.setDate(1);
  const within = { $gte: dateFrom, $lte: dateTo };
  const run = async (name, query) => {
    const explanation = await query;
    const metrics = resultMetrics(explanation);
    reports.push({ name, ...metrics });
  };
  const find = (Model, filter, sort, limit = 10) =>
    Model.find(filter).sort(sort).skip(0).limit(limit).lean().explain("executionStats");
  const countExplain = (Model, filter, hint) =>
    Model.aggregate([
      { $match: filter },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]).hint(hint).explain("executionStats");

  const doctorFilters = [
    ["Doctors list: createdAt desc", {}, { createdAt: -1 }],
    ["Doctors list: search", { searchTokens: { $all: tokenPatterns("Doctor 0499") } }, { createdAt: -1 }],
    ["Doctors list: specialization", { specialization: "Cardiology" }, { createdAt: -1 }],
    ["Doctors list: hospital", { hospital: "Central Hospital" }, { createdAt: -1 }],
    ["Doctors list: date range", { createdAt: within }, { createdAt: -1 }],
    ["Doctors list: name sort", {}, { name: 1 }],
  ];
  for (const [name, filter, sort] of doctorFilters) await run(name, find(DoctorModel, filter, sort));

  const patientFilters = [
    ["Patients list: default", {}, { createdAt: -1 }],
    ["Patients list: search", { searchTokens: { $all: tokenPatterns("Patient 29999") } }, { createdAt: -1 }],
    ["Patients list: condition", { condition: "Hypertension" }, { createdAt: -1 }],
    ["Patients list: doctor", { doctor: doctor._id }, { createdAt: -1 }],
    ["Patients list: doctor + date", { doctor: doctor._id, createdAt: within }, { createdAt: -1 }],
    ["Patients list: gender", { gender: "female" }, { createdAt: -1 }],
    ["Patients list: date range", { createdAt: within }, { createdAt: -1 }],
    ["Patients list: name sort", {}, { name: 1 }],
    ["Patients list: age sort", {}, { age: 1 }],
    ["Patients list: condition sort", {}, { condition: 1 }],
  ];
  for (const [name, filter, sort] of patientFilters) await run(name, find(PatientModel, filter, sort));
  await run("Doctor patients list", find(PatientModel, { doctor: doctor._id }, { createdAt: -1 }));
  await run("Doctor patients list: search", find(PatientModel, { doctor: selectivePatient.doctor, searchTokens: { $all: tokenPatterns("Patient 29999") } }, { createdAt: -1 }));

  for (const prefix of ["a", "m", "s", "me"]) {
    const patterns = tokenPatterns(prefix);
    const commonPatient = await PatientModel.findOne({ searchTokens: { $all: patterns } }, { doctor: 1 }).lean();
    const commonDoctorId = commonPatient?.doctor ?? doctor._id;
    await run(`Common-prefix doctors search: ${prefix}`, find(DoctorModel, { searchTokens: { $all: patterns } }, { createdAt: -1 }, 10));
    await run(`Common-prefix patients search: ${prefix}`, find(PatientModel, { searchTokens: { $all: patterns } }, { createdAt: -1 }, 10));
    await run(`Common-prefix doctor-patients search: ${prefix}`, find(PatientModel, { doctor: commonDoctorId, searchTokens: { $all: patterns } }, { createdAt: -1 }, 10));
  }
  await run("Doctors list patientCount aggregation", PatientModel.aggregate([
    { $match: { doctor: { $in: doctorsInListPage.map((item) => item._id) } } },
    { $group: { _id: "$doctor", count: { $sum: 1 } } },
  ]).hint({ doctor: 1, createdAt: -1 }).explain("executionStats"));

  const dashboard = [
    ["Dashboard: total doctors", countExplain(DoctorModel, {}, { _id: 1 })],
    ["Dashboard: total patients", countExplain(PatientModel, {}, { _id: 1 })],
    ["Dashboard: last 7 days", countExplain(PatientModel, { createdAt: { $gte: last7From } }, { createdAt: -1 })],
    ["Dashboard: last 30 days", countExplain(PatientModel, { createdAt: { $gte: last30From } }, { createdAt: -1 })],
    ["Dashboard: patients per doctor", PatientModel.aggregate([{ $group: { _id: "$doctor", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }, { $lookup: { from: "doctors", localField: "_id", foreignField: "_id", as: "doc" } }, { $unwind: "$doc" }, { $project: { _id: 0, doctorId: "$_id", name: "$doc.name", specialization: "$doc.specialization", count: 1 } }]).hint({ doctor: 1, createdAt: -1 }).explain("executionStats")],
    ["Dashboard: patients over time", PatientModel.aggregate([{ $match: { createdAt: within } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Dhaka" } }, count: { $sum: 1 } } }]).hint({ createdAt: -1 }).explain("executionStats")],
    [
      "Dashboard: doctors over time",
      DoctorModel.aggregate([
        { $match: { createdAt: { $gte: sixMonthsFrom } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m",
                date: "$createdAt",
                timezone: "Asia/Dhaka",
              },
            },
            count: { $sum: 1 },
          },
        },
      ]).hint({ createdAt: -1 }).explain("executionStats"),
    ],
    ["Dashboard: condition distribution", PatientModel.aggregate([{ $group: { _id: "$condition", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]).hint({ condition: 1, createdAt: -1 }).explain("executionStats")],
    ["Dashboard specialization OLD (lookup per patient)", PatientModel.aggregate([{ $lookup: { from: "doctors", localField: "doctor", foreignField: "_id", as: "doc" } }, { $unwind: "$doc" }, { $group: { _id: "$doc.specialization", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]).hint({ doctor: 1, createdAt: -1 }).explain("executionStats")],
    ["Dashboard specialization NEW (group by doctor first)", PatientModel.aggregate([{ $group: { _id: "$doctor", count: { $sum: 1 } } }, { $lookup: { from: "doctors", localField: "_id", foreignField: "_id", as: "doc" } }, { $unwind: "$doc" }, { $group: { _id: "$doc.specialization", count: { $sum: "$count" } } }, { $sort: { count: -1, _id: 1 } }]).hint({ doctor: 1, createdAt: -1 }).explain("executionStats")],
    ["Dashboard: gender distribution", PatientModel.aggregate([{ $group: { _id: "$gender", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]).hint({ gender: 1, createdAt: -1 }).explain("executionStats")],
    ["Dashboard: recent patients", PatientModel.find().sort({ createdAt: -1 }).limit(5).lean().explain("executionStats")],
  ];
  for (const [name, query] of dashboard) await run(name, query);
  console.log(`Explain report for isolated database ${targetName}`);
  console.log("Query | Stage | Index | Docs examined | Returned | ms | Blocking SORT | Flag");
  for (const item of reports) console.log(`${item.name} | ${item.stage} | ${item.index} | ${item.docs} | ${item.returned} | ${item.millis} | ${item.sort} | ${item.flag ? "FLAG" : "ok"}`);
  console.log(`Flagged ${reports.filter((item) => item.flag).length}/${reports.length} query shapes.`);
  const common = reports.filter((item) => item.name.startsWith("Common-prefix"));
  console.log("Common-prefix search | Docs examined | Returned | ms | Blocking SORT problem");
  for (const item of common) console.log(`${item.name} | ${item.docs} | ${item.returned} | ${item.millis} | ${item.sort === "yes" && (item.docs > 5000 || item.millis > 50) ? "yes" : "no"}`);
} finally {
  if (connected && mongoose.connection.name === "doctor-tracker-perf") {
    await mongoose.connection.dropDatabase();
    console.log("Dropped doctor-tracker-perf.");
  }
  if (connected) await mongoose.disconnect();
}
