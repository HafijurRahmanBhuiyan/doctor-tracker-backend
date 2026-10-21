import { Router } from "express";
import healthRoutes from "./health";
import authRoutes from "./auth";
import doctorRoutes from "./doctors";
import { protect, authorize } from "../middlewares/auth";

const router = Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/doctors", doctorRoutes);

// Protect all other routes
router.use(protect);
router.use(authorize("admin"));

export default router;
