import { Router } from "express";
import {
  getPatients,
  createPatient,
  getPatientFilters,
  getPatient,
  updatePatient,
  deletePatient,
} from "../controllers/patientController";
import { protect, authorize } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import {
  createPatientSchema,
  updatePatientSchema,
  patientIdSchema,
} from "../validators/patient";

const router = Router();

// All routes protected and admin only
router.use(protect);
router.use(authorize("admin"));

router.get("/", getPatients);
router.post("/", validate(createPatientSchema), createPatient);
// Must be defined BEFORE /:id
router.get("/filters/options", getPatientFilters);
router.get("/:id", validate(patientIdSchema), getPatient);
router.put("/:id", validate(updatePatientSchema), updatePatient);
router.delete("/:id", validate(patientIdSchema), deletePatient);

export default router;
