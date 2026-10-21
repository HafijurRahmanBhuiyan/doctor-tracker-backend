import { Request } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config/config";

const TOO_MANY_REQUESTS_MESSAGE = "Too many requests, please try again later.";

/**
 * Health checks must never be throttled (they are used by uptime monitors and
 * by the smoke suites), so they do not count towards the quota.
 */
const isHealthCheck = (req: Request): boolean => {
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path;
  return path === "/health" || path === "/api/v1/health";
};

export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX, // limit each IP to N requests per windowMs
  standardHeaders: true, // RateLimit-Limit / -Remaining / -Reset
  legacyHeaders: false, // no X-RateLimit-* headers
  skip: isHealthCheck,
  message: {
    success: false,
    data: null,
    message: TOO_MANY_REQUESTS_MESSAGE,
  },
});
