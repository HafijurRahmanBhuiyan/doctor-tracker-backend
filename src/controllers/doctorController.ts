import { Request, Response } from "express";
import mongoose from "mongoose";
import Doctor from "../models/Doctor";
import Patient from "../models/Patient";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";

export const createDoctor = asyncHandler(async (req: Request, res: Response) => {
  const { name, specialization, hospital, phone, email } = req.body;

  const existingDoctor = await Doctor.findOne({ email: email.toLowerCase() });
  if (existingDoctor) {
    throw new AppError("Doctor with this email already exists", 409);
  }

  const doctor = await Doctor.create({
    name,
    specialization,
    hospital,
    phone,
    email: email.toLowerCase(),
  });

  res.status(201).json({
    success: true,
    data: { doctor },
    message: "Doctor created successfully",
  });
});

export const getDoctors = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  let limit = parseInt(req.query.limit as string) || 10;
  if (limit > 50) limit = 50;

  const search = req.query.search as string;
  const specialization = req.query.specialization as string;
  const hospital = req.query.hospital as string;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const sortBy = (req.query.sortBy as string) || "createdAt";
  const order = req.query.order === "asc" ? 1 : -1;

  const query: any = {};

  if (search) {
    // Use text search when possible, fallback to regex
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  if (specialization) {
    query.specialization = specialization;
  }

  if (hospital) {
    query.hospital = hospital;
  }

  if (from || to) {
    query.createdAt = {};
    if (from) {
      query.createdAt.$gte = new Date(from);
    }
    if (to) {
      query.createdAt.$lte = new Date(to);
    }
  }

  const skip = (page - 1) * limit;

  const [doctors, total] = await Promise.all([
    Doctor.find(query)
      .sort({ [sortBy]: order })
      .skip(skip)
      .limit(limit)
      .lean(),
    Doctor.countDocuments(query),
  ]);

  // Get patient counts efficiently with ONE aggregation
  const doctorIds = doctors.map((d: any) => d._id);
  const patientCounts = await Patient.aggregate([
    { $match: { doctor: { $in: doctorIds } } },
    { $group: { _id: "$doctor", count: { $sum: 1 } } },
  ]);

  const countMap = new Map(patientCounts.map((pc) => [pc._id.toString(), pc.count]));

  const doctorsWithCount = doctors.map((doctor: any) => ({
    ...doctor,
    patientCount: countMap.get(doctor._id.toString()) || 0,
  }));

  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    success: true,
    data: doctorsWithCount,
    message: "Doctors retrieved successfully",
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
  });
});

export const getDoctorFilters = asyncHandler(async (req: Request, res: Response) => {
  const [specializations, hospitals] = await Promise.all([
    Doctor.distinct("specialization"),
    Doctor.distinct("hospital"),
  ]);

  res.status(200).json({
    success: true,
    data: {
      specializations: specializations.sort(),
      hospitals: hospitals.sort(),
    },
    message: "Filters retrieved successfully",
  });
});

export const getDoctor = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid ObjectId", 400);
  }

  const doctor = await Doctor.findById(id).lean();
  if (!doctor) {
    throw new AppError("Doctor not found", 404);
  }

  const patientCount = await Patient.countDocuments({ doctor: id });

  res.status(200).json({
    success: true,
    data: { doctor: { ...doctor, patientCount } },
    message: "Doctor retrieved successfully",
  });
});

export const updateDoctor = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid ObjectId", 400);
  }

  if (req.body.email) {
    const existingDoctor = await Doctor.findOne({
      email: req.body.email.toLowerCase(),
      _id: { $ne: id },
    });
    if (existingDoctor) {
      throw new AppError("Doctor with this email already exists", 409);
    }
    req.body.email = req.body.email.toLowerCase();
  }

  const doctor = await Doctor.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!doctor) {
    throw new AppError("Doctor not found", 404);
  }

  res.status(200).json({
    success: true,
    data: { doctor },
    message: "Doctor updated successfully",
  });
});

export const deleteDoctor = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid ObjectId", 400);
  }

  const doctor = await Doctor.findById(id);
  if (!doctor) {
    throw new AppError("Doctor not found", 404);
  }

  // Cascade delete its patients; document this in a code comment
  await Patient.deleteMany({ doctor: id });
  await Doctor.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    data: null,
    message: "Doctor and associated patients deleted successfully",
  });
});

export const getDoctorPatients = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid ObjectId", 400);
  }

  const doctor = await Doctor.findById(id);
  if (!doctor) {
    throw new AppError("Doctor not found", 404);
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  let limit = parseInt(req.query.limit as string) || 10;
  if (limit > 50) limit = 50;
  const search = req.query.search as string;

  const query: any = { doctor: id };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { condition: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (page - 1) * limit;

  const [patients, total] = await Promise.all([
    Patient.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Patient.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    success: true,
    data: patients,
    message: "Patients retrieved successfully",
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
  });
});

export const addPatientToDoctor = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid ObjectId", 400);
  }

  const doctor = await Doctor.findById(id);
  if (!doctor) {
    throw new AppError("Doctor not found", 404);
  }

  const { name, age, gender, phone, email, condition, notes } = req.body;

  const patient = await Patient.create({
    name,
    age,
    gender,
    phone,
    email: email || undefined,
    condition,
    notes,
    doctor: id,
  });

  res.status(201).json({
    success: true,
    data: { patient },
    message: "Patient added successfully",
  });
});

export const removePatientFromDoctor = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const patientId = req.params.patientId as string;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(patientId)) {
    throw new AppError("Invalid ObjectId", 400);
  }

  const patient = await Patient.findOne({ _id: patientId, doctor: id });
  if (!patient) {
    throw new AppError("Patient not found", 404);
  }

  await Patient.findByIdAndDelete(patientId);

  res.status(200).json({
    success: true,
    data: null,
    message: "Patient removed successfully",
  });
});
