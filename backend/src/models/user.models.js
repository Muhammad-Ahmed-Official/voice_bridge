import mongoose from 'mongoose';
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      unique: true,
    },
    // Global preference: when true, backend will try ElevenLabs TTS
    voiceCloningEnabled: {
      type: Boolean,
      default: false,
    },
    // Optional: specific ElevenLabs voice id per user. If empty, default voice is used.
    voiceId: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);


// Method for bcrypt password (async hook – don't use next, Mongoose waits for the promise)
userSchema.pre("save", async function () {
    if (!this.isModified("password")) return;
    this.password = await bcrypt.hash(this.password, 10);
});


//Method for compare password
userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
};

export const User = mongoose.model("User", userSchema);