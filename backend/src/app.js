import express from "express";
import cors from "cors";
import authRouter from "./routes/auth.routes.js";
import historyRouter from "./routes/history.routes.js";
const app = express();

// Middleware Configurations – allow frontend (Expo web) origins
const allowedOrigins = [
  "http://localhost:8081",
  "http://localhost:19006",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:19006",
  "exp://192.168.0.105:8081",
  ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN.replace(/^"|"$/g, "")] : []),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return cb(null, true);
    if (origin.includes("vercel.app") || origin.includes(".onrender.com")) return cb(null, true);
    return cb(null, false);
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
}));
// Handle preflight for all API routes (helps on Vercel serverless)
app.options("*", cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

// Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/history", historyRouter);

export default app;