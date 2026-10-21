import app from "./app";
import mongoose from "mongoose";
import { config } from "./config/config";
import { seedAdmin } from "./seed/admin";

const startServer = async () => {
  try {
    await mongoose.connect(config.MONGO_URI);
    console.log("MongoDB connected");

    await seedAdmin();
    
    app.listen(config.PORT, () => {
      console.log(`Server running on port ${config.PORT} in ${config.NODE_ENV} mode`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
