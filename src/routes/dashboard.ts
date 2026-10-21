import { Router } from "express";
import { getDashboardStats } from "../controllers/dashboardController";
import { protect, authorize } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { dashboardStatsSchema } from "../validators/dashboard";

const router = Router();

// All routes protected and admin only
router.use(protect);
router.use(authorize("admin"));

router.get("/stats", validate(dashboardStatsSchema), getDashboardStats);

export default router;
