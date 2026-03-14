import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "voice-bridge";

export const connectDB = async () => {
  if (!MONGO_URI || !MONGO_URI.startsWith("mongodb")) {
    console.error("MONGO_URI is missing or invalid in environment.");
    process.exit(1);
  }
  try {
    await mongoose.connect(`${MONGO_URI}/${DB_NAME}`, {
      serverSelectionTimeoutMS: 15000,
      bufferCommands: false,
    });
    console.log(
      "MongoDB Connected at:",
      mongoose.connection.host,
      "db:",
      DB_NAME,
    );
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
};

export const isDbConnected = () => mongoose.connection.readyState === 1;

// Gracefully handle application termination
process.on('SIGINT', async () => {
    console.log("Application is terminating...");
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        console.log("MongoDB Connection Closed");
    }
    process.exit(0);
});
