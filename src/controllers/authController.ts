import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import { config } from "../config/config";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";

const generateToken = (id: string): string => {
  return jwt.sign({ id }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as any,
  });
};

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Find user with password
  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

  if (!user) {
    throw new AppError("Invalid credentials", 401);
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    throw new AppError("Invalid credentials", 401);
  }

  const token = generateToken(user._id.toString());

  res.status(200).json({
    success: true,
    data: {
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
    message: "Login successful",
  });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: { user: req.user },
    message: "User retrieved successfully",
  });
});
