import express from "express";
import cors from "cors";
import authRouter from "./routes/auth.routes.js";
import historyRouter from "./routes/history.routes.js";
const app = express();

// 1) Set CORS headers on every response first (so they're always present, including errors)
function allowOrigin(origin) {
  if (!origin) return true;
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return true;
  if (origin.includes("vercel.app") || origin.includes(".onrender.com")) return true;
  return false;
}
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && allowOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowOrigin(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
}));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

// Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/history", historyRouter);

export default app;