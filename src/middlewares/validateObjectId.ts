import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { AppError } from "../utils/AppError";

export const validateObjectId = (paramName: string = "id") => {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params[paramName] as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("Invalid ObjectId", 400);
    }
    next();
  };
};
