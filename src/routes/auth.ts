import { Router } from "express";
import { login, getMe } from "../controllers/authController";
import { validate } from "../middlewares/validate";
import { loginSchema } from "../validators/auth";
import { loginRateLimiter } from "../middlewares/loginRateLimiter";
import { protect } from "../middlewares/auth";

const router = Router();

router.post("/login", loginRateLimiter, validate(loginSchema), login);
router.get("/me", protect, getMe);

export default router;
