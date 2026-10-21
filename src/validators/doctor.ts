import { z } from "zod";
import { dateRangeQuerySchema } from "../utils/dateRange";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// Query schema for GET /doctors: the `from` / `to` range is validated by the
// shared date range schema (invalid dates and inverted ranges -> 400).
export const listDoctorsSchema = z.object({
  query: dateRangeQuerySchema,
});

export const createDoctorSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
    specialization: z.string().min(1, "Specialization is required"),
    hospital: z.string().min(1, "Hospital is required"),
    phone: z.string().min(1, "Phone is required"),
    email: z.string().email("Invalid email address"),
  }),
});

export const updateDoctorSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    specialization: z.string().min(1).optional(),
    hospital: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
  }),
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
});

export const doctorIdSchema = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
});

export const createPatientSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
    age: z.coerce.number().min(0, "Age must be at least 0").max(130, "Age must be at most 130"),
    gender: z.enum(["male", "female", "other"]),
    phone: z.string().min(1, "Phone is required"),
    email: z.string().email().optional().or(z.literal("")),
    condition: z.string().min(1, "Condition is required"),
    notes: z.string().optional(),
  }),
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
});

export const deletePatientSchema = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid ObjectId"),
    patientId: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
});

export const listPatientsSchema = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
});
