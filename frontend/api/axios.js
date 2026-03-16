import axios from "axios";

// Resolve the base API URL depending on environment
const getApiUrl = () => {
  // Priority 1: Environment variable — always use this in production/APK builds
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // Priority 2: Web browser (window.location exists only in real browsers)
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    if (window.location.hostname === 'localhost') {
      return "https://voice-bridge-gules.vercel.app/api/v1";
    }
    return "https://voice-bridge-gules.vercel.app/api/v1";
  }

  // Priority 3: Native (React Native — no window.location)
  return "https://voice-bridge-gules.vercel.app/api/v1";
};

// Main shared axios instance used across the app
export const axiosInstance = axios.create({
  baseURL: getApiUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});

// Backwards-compat alias (some older code may still import API_BASE_URL)
export const API_BASE_URL = axiosInstance;