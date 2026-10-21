import { z } from "zod";
import { dateRangeQuerySchema } from "../utils/dateRange";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const genderEnum = z.enum(["male", "female", "other"]);

// Query schema for GET /patients: the `from` / `to` range is validated by the
// shared date range schema (invalid dates and inverted ranges -> 400).
export const listPatientsSchema = z.object({
  query: dateRangeQuerySchema,
});

export const createPatientSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
    age: z.coerce.number().min(0, "Age must be at least 0").max(130, "Age must be at most 130"),
    gender: genderEnum,
    phone: z.string().min(1, "Phone is required"),
    email: z
      .string()
      .email("Invalid email address")
      .optional()
      .or(z.literal("")),
    condition: z.string().min(1, "Condition is required"),
    notes: z.string().optional(),
    doctorId: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
});

export const updatePatientSchema = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
  body: z
    .object({
      name: z.string().min(1).optional(),
      age: z.coerce
        .number()
        .min(0, "Age must be at least 0")
        .max(130, "Age must be at most 130")
        .optional(),
      gender: genderEnum.optional(),
      phone: z.string().min(1).optional(),
      email: z
        .string()
        .email("Invalid email address")
        .optional()
        .or(z.literal("")),
      condition: z.string().min(1).optional(),
      notes: z.string().optional(),
      doctorId: z.string().regex(objectIdRegex, "Invalid ObjectId").optional(),
    })
    .strict(),
});

export const patientIdSchema = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid ObjectId"),
  }),
});
