import axios from "axios";
// config.js
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


export const API_BASE_URL = axios.create({
  baseURL: getApiUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});