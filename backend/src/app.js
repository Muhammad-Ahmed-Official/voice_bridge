import express from "express";
import cors from "cors";
import { isDbConnected, ensureConnection } from "./db/index.js";
import authRouter from "./routes/auth.routes.js";
import historyRouter from "./routes/history.routes.js";
import chatRouter from "./routes/chat.routes.js";

const app = express();

app.use(cors()); 
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API Running 🚀");
});

app.use("/api/v1", async (req, res, next) => {
  if (isDbConnected()) return next();
  try {
    await ensureConnection();
  } catch (err) {
    console.error("[DB] ensureConnection failed:", err.message);
    return res.status(503).json({
      status: false,
      message: "Database is not ready. Please try again in a moment.",
    });
  }
  if (!isDbConnected()) {
    return res.status(503).json({
      status: false,
      message: "Database is not ready. Please try again in a moment.",
    });
  }
  next();
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/history", historyRouter);
app.use("/api/v1/chat", chatRouter);

app.use((req, res) => {
  res.status(404).json({ message: "Not Found" });
});

export default app;