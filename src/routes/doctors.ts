import { Router } from "express";
import {
  createDoctor,
  getDoctors,
  getDoctorFilters,
  getDoctor,
  updateDoctor,
  deleteDoctor,
  getDoctorPatients,
  addPatientToDoctor,
  removePatientFromDoctor,
} from "../controllers/doctorController";
import { protect, authorize } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import {
  createDoctorSchema,
  updateDoctorSchema,
  doctorIdSchema,
  createPatientSchema,
  deletePatientSchema,
  listPatientsSchema,
} from "../validators/doctor";

const router = Router();

// All routes protected and admin only
router.use(protect);
router.use(authorize("admin"));

router.post("/", validate(createDoctorSchema), createDoctor);
router.get("/", getDoctors);
router.get("/filters/options", getDoctorFilters); // define this route BEFORE /:id
router.get("/:id", validate(doctorIdSchema), getDoctor);
router.put("/:id", validate(updateDoctorSchema), updateDoctor);
router.delete("/:id", validate(doctorIdSchema), deleteDoctor);
router.get("/:id/patients", validate(listPatientsSchema), getDoctorPatients);
router.post("/:id/patients", validate(createPatientSchema), addPatientToDoctor);
router.delete("/:id/patients/:patientId", validate(deletePatientSchema), removePatientFromDoctor);

export default router;
