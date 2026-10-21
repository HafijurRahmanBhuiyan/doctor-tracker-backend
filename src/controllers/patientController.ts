import { Request, Response } from "express";
import mongoose from "mongoose";
import Patient from "../models/Patient";
import Doctor from "../models/Doctor";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { resolveDateRange } from "../utils/dateRange";

const PATIENT_SORT_WHITELIST = ["createdAt", "name", "age", "condition"] as const;
const DOCTOR_POPULATE = { path: "doctor", select: "name specialization" };

export const getPatients = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  let limit = parseInt(req.query.limit as string) || 10;
  if (limit > 50) limit = 50;

  const search = req.query.search as string;
  const condition = req.query.condition as string;
  const doctor = req.query.doctor as string;
  const gender = req.query.gender as string;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const sortByInput = req.query.sortBy as string;
  const sortBy = (PATIENT_SORT_WHITELIST as readonly string[]).includes(sortByInput)
    ? sortByInput
    : "createdAt";
  const order = req.query.order === "asc" ? 1 : -1;

  const query: any = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { condition: { $regex: search, $options: "i" } },
    ];
  }
  if (condition) query.condition = condition;
  if (doctor) {
    if (!mongoose.Types.ObjectId.isValid(doctor)) {
      throw new AppError("Invalid ObjectId", 400);
    }
    query.doctor = doctor;
  }
  if (gender) {
    if (!["male", "female", "other"].includes(gender)) {
      throw new AppError("Invalid gender", 400);
    }
    query.gender = gender;
  }
  if (from || to) {
    // Date-only `from` / `to` are resolved by the shared helper: `from` is the
    // start of that UTC day, `to` the end of that UTC day.
    const range = resolveDateRange(from, to);
    query.createdAt = {};
    if (range.from) query.createdAt.$gte = range.from;
    if (range.to) query.createdAt.$lte = range.to;
  }

  const skip = (page - 1) * limit;

  const [patients, total] = await Promise.all([
    Patient.find(query)
      .populate(DOCTOR_POPULATE)
      .sort({ [sortBy]: order })
      .skip(skip)
      .limit(limit)
      .lean(),
    Patient.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: patients,
    message: "Patients retrieved successfully",
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const { name, age, gender, phone, email, condition, notes, doctorId } = req.body;

  const doctorExists = await Doctor.exists({ _id: doctorId });
  if (!doctorExists) {
    throw new AppError("Doctor not found", 404);
  }

  const patient = await Patient.create({
    name,
    age,
    gender,
    phone,
    email: email || undefined,
    condition,
    notes,
    doctor: doctorId,
  });

  const populated = await Patient.findById(patient._id).populate(DOCTOR_POPULATE).lean();

  res.status(201).json({
    success: true,
    data: { patient: populated },
    message: "Patient created successfully",
  });
});

export const getPatientFilters = asyncHandler(async (req: Request, res: Response) => {
  const conditions = await Patient.distinct("condition");

  res.status(200).json({
    success: true,
    data: { conditions: conditions.sort() },
    message: "Filters retrieved successfully",
  });
});

export const getPatient = asyncHandler(async (req: Request, res: Response) => {
  const patient = await Patient.findById(req.params.id as string)
    .populate(DOCTOR_POPULATE)
    .lean();

  if (!patient) {
    throw new AppError("Patient not found", 404);
  }

  res.status(200).json({
    success: true,
    data: { patient },
    message: "Patient retrieved successfully",
  });
});

export const updatePatient = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, age, gender, phone, email, condition, notes, doctorId } = req.body;

  const patient = await Patient.findById(id);
  if (!patient) {
    throw new AppError("Patient not found", 404);
  }

  if (doctorId) {
    const doctorExists = await Doctor.exists({ _id: doctorId });
    if (!doctorExists) {
      throw new AppError("Doctor not found", 404);
    }
    patient.doctor = new mongoose.Types.ObjectId(doctorId);
  }
  if (name !== undefined) patient.name = name;
  if (age !== undefined) patient.age = age;
  if (gender !== undefined) patient.gender = gender;
  if (phone !== undefined) patient.phone = phone;
  if (email !== undefined) patient.email = email || undefined;
  if (condition !== undefined) patient.condition = condition;
  if (notes !== undefined) patient.notes = notes;

  await patient.save();

  const populated = await Patient.findById(id).populate(DOCTOR_POPULATE).lean();

  res.status(200).json({
    success: true,
    data: { patient: populated },
    message: "Patient updated successfully",
  });
});

export const deletePatient = asyncHandler(async (req: Request, res: Response) => {
  const patient = await Patient.findByIdAndDelete(req.params.id as string);
  if (!patient) {
    throw new AppError("Patient not found", 404);
  }

  res.status(200).json({
    success: true,
    data: null,
    message: "Patient deleted successfully",
  });
});
