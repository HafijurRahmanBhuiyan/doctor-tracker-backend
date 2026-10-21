import rateLimit from "express-rate-limit";
import { config } from "../config/config";

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.LOGIN_RATE_LIMIT_MAX, // limit each IP to N login requests per windowMs
  message: {
    success: false,
    data: null,
    message: "Too many login attempts, please try again later.",
  },
});
