import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/config";
import User from "../models/User";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token: string | undefined;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new AppError("Not authorized to access this route", 401);
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as { id: string };
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      throw new AppError("User not found", 401);
    }

    req.user = {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    throw new AppError("Not authorized to access this route", 401);
  }
});

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError("Not authorized to access this route", 403);
    }
    next();
  };
};
