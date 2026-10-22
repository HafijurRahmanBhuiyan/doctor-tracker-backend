import mongoose, { Document, Schema } from "mongoose";
import { searchTokens } from "../utils/searchTokens";

export interface IDoctor extends Document {
  name: string;
  specialization: string;
  hospital: string;
  phone: string;
  email: string;
  searchTokens: string[];
  createdAt: Date;
  updatedAt: Date;
}

const doctorSchema = new Schema<IDoctor>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    specialization: {
      type: String,
      required: [true, "Specialization is required"],
      trim: true,
    },
    hospital: {
      type: String,
      required: [true, "Hospital is required"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
    },
    searchTokens: { type: [String], select: false },
  },
  {
    timestamps: true,
  }
);

// Indexes
doctorSchema.index({ email: 1 }, { unique: true });
doctorSchema.index({ createdAt: -1 });
doctorSchema.index({ name: 1 });
doctorSchema.index({ searchTokens: 1, createdAt: -1 });
doctorSchema.index({ specialization: 1, createdAt: -1 });
doctorSchema.index({ hospital: 1, createdAt: -1 });

doctorSchema.pre("validate", function () {
  this.searchTokens = searchTokens(
    this.name,
    this.email,
    this.phone,
    this.specialization,
    this.hospital
  );
});

const Doctor = mongoose.model<IDoctor>("Doctor", doctorSchema);

export default Doctor;
