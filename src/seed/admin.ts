import User from "../models/User";
import { config } from "../config/config";

export const seedAdmin = async () => {
  try {
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
      console.log("ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin seed");
      return;
    }

    const existingAdmin = await User.findOne({ email: config.ADMIN_EMAIL.toLowerCase() });

    if (existingAdmin) {
      console.log("Admin already exists");
      return;
    }

    await User.create({
      name: "Admin",
      email: config.ADMIN_EMAIL.toLowerCase(),
      password: config.ADMIN_PASSWORD,
      role: "admin",
    });

    console.log("Admin seeded successfully");
  } catch (error) {
    console.error("Error seeding admin:", error);
  }
};
