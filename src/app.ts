import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { config } from "./config/config";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { notFound } from "./middlewares/notFound";
import { rateLimiter } from "./middlewares/rateLimiter";

const app = express();

app.set("trust proxy", 1);

// Security middlewares
app.use(helmet());
app.use(
  cors({
    origin: config.CLIENT_URL,
    credentials: true,
  })
);
app.use(rateLimiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (config.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Routes
app.use("/api/v1", routes);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
