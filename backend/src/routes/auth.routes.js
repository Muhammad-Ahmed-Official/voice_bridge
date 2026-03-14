import { Router } from "express";
import { signIn, signUp, updatePreferences } from "../controllers/auth.controller.js";

const authRouter = Router();

authRouter.route("/signup").post(signUp);
authRouter.route("/signin").post(signIn);

// Update simple user preferences (e.g. ElevenLabs voice cloning toggle)
authRouter.route("/preferences").patch(updatePreferences);

export default authRouter;