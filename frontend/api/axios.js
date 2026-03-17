import axios from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

const getApiUrl = () => {
  // 1) Respect explicit env override (recommended for builds)
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 2) Default: always use deployed backend
  return "https://voice-bridge-gules.vercel.app/api/v1/";
};

export const axiosInstance = axios.create({
  baseURL: getApiUrl(),
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000, 
});

export const API_BASE_URL = axiosInstance;



// // Resolve the base API URL depending on environment
// const getApiUrl = () => {
//   // Priority 1: Environment variable — always use this in production/APK builds
//   if (process.env.EXPO_PUBLIC_API_URL) {
//     return process.env.EXPO_PUBLIC_API_URL;
//   }

//   // Priority 2: Web browser (window.location exists only in real browsers)
//   if (typeof window !== 'undefined' && window.location && window.location.hostname) {
//     if (window.location.hostname === 'localhost') {
//       return "https://voice-bridge-gules.vercel.app/api/v1/";
//     }
//     return "https://voice-bridge-gules.vercel.app/api/v1/";
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
//   return "https://voice-bridge-gules.vercel.app/api/v1/";
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


// // import axios from 'axios';
// // import { Platform } from 'react-native';

// // const LOCAL_API_URL = Platform.select({
// //     default: "https://voice-bridge-gules.vercel.app/api/v1/",
// //     android: "https://voice-bridge-gules.vercel.app/api/v1/",
// //     ios:     "http://192.168.0.106:3000/api/v1/",
// // });
// // const api = axios.create({ baseURL: LOCAL_API_URL, timeout: 10000, })
// // export const API_BASE_URL = api;

// // https://voice-bridge-gules.vercel.app/api/v1/


// // const LOCAL_API_URL = Platform.select({
// //   default: 'http://localhost:3000/api/v1',
// //   android: 'http://192.168.0.106:3000/api/v1',
// //   ios: 'http://192.168.0.106:3000/api/v1',
// // });

// // // Main shared axios instance used across the app
// // export const axiosInstance = axios.create({
// //   baseURL: LOCAL_API_URL,
// //   timeout: 10000,
// // });

// // Backwards-compat alias (older code may still import API_BASE_URL)
// // export const API_BASE_URL = axiosInstance;