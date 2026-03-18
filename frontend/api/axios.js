import axios from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

const getApiUrl = () => {
  // 1) Respect explicit env override (recommended for builds)
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 2) Default: always use deployed backend
  return "https://voice-bridge-backend-xq5w.onrender.com/api/v1/";
};

export const axiosInstance = axios.create({
  baseURL: getApiUrl(),
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000, 
});

export const API_BASE_URL = axiosInstance;





// const getApiUrl = () => {
//   // Priority 1: Environment variable — always use this in production/APK builds
//   if (process.env.EXPO_PUBLIC_API_URL) {
//     return process.env.EXPO_PUBLIC_API_URL;
//   }

//   // Priority 2: Web browser (window.location exists only in real browsers)
//   if (typeof window !== 'undefined' && window.location && window.location.hostname) {
//     if (window.location.hostname === 'localhost') {
//       return "http://localhost:3000/api/v1/";
//     }
//     return "http://localhost:3000/api/v1/";
//   }
//   // Priority 3: Native (React Native — no window.location)
//   // In dev (Expo Go / local LAN), use the same host IP as the Metro dev server
//   // so REST calls hit the local backend just like sockets do.
//   if (Platform.OS !== "web") {
//     const hostUri = Constants.expoConfig?.hostUri;
//     if (hostUri) {
//       const ip = hostUri.split(":")[0];
//       return `http://${ip}:3000/api/v1`;
//     }
//   }
//   // Fallback (native without hostUri): use production API
//   return "http://localhost:3000/api/v1/";
// };
// // Main shared axios instance used across the app
// export const axiosInstance = axios.create({
//   baseURL: getApiUrl(),
//   headers: {
//     "Content-Type": "application/json",
//   },
// });
// // Backwards-compat alias (some older code may still import API_BASE_URL)
// export const API_BASE_URL = axiosInstance;

