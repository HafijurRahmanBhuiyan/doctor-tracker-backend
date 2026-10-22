import mongoose, { Document, Schema, Types } from "mongoose";
import { searchTokens } from "../utils/searchTokens";

export interface IPatient extends Document {
  name: string;
  age: number;
  gender: "male" | "female" | "other";
  phone: string;
  email?: string;
  condition: string;
  notes?: string;
  doctor: Types.ObjectId;
  searchTokens: string[];
  createdAt: Date;
  updatedAt: Date;
}

const patientSchema = new Schema<IPatient>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    age: {
      type: Number,
      required: [true, "Age is required"],
      min: [0, "Age must be positive"],
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
      required: [true, "Gender is required"],
    },
    phone: {
      type: String,
      required: [true, "Phone is required"],
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    condition: {
      type: String,
      required: [true, "Condition is required"],
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: [true, "Doctor is required"],
    },
    searchTokens: { type: [String], select: false },
  },
  {
    timestamps: true,
  }
);

// Indexes (each declared in exactly ONE place)
patientSchema.index({ doctor: 1, createdAt: -1 });
patientSchema.index({ gender: 1, createdAt: -1 });
patientSchema.index({ createdAt: -1 });
patientSchema.index({ name: 1 });
patientSchema.index({ searchTokens: 1, createdAt: -1 });
patientSchema.index({ age: 1 });
patientSchema.index({ condition: 1, createdAt: -1 });
patientSchema.index({ doctor: 1, searchTokens: 1, createdAt: -1 });

patientSchema.pre("validate", function () {
  this.searchTokens = searchTokens(this.name, this.email, this.phone, this.condition);
});

const Patient = mongoose.model<IPatient>("Patient", patientSchema);

export default Patient;
