import { Router } from "express";
import healthRoutes from "./health";
import authRoutes from "./auth";
import { protect, authorize } from "../middlewares/auth";

const router = Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);

// Protect all other routes - add a placeholder to ensure protection
// All routes except /health and /auth/* need protection as per requirement
// We'll protect at app level or add middleware; easier to add protect here for remaining
router.use(protect);
router.use(authorize("admin"));

export default router;
