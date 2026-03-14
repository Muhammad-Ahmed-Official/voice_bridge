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
      return "http://localhost:3000";
    }
    return "https://voice-bridge-gules.vercel.app/api/v1";
  }

  // Priority 3: Native (React Native — no window.location)
  return "https://voice-bridge-gules.vercel.app/api/v1";
};


export const API_BASE_URL = axios.create({
  baseURL: getApiUrl(),
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});



// import axios from "axios";
// const BASE_URL = "https://voice-bridge-pfzq4vdxj-muhammadahmedanis-projects.vercel.app/api/v1";

// export const axiosInstance = axios.create({
//   baseURL: BASE_URL,
//   timeout: 15000,
// });

