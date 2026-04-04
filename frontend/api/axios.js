import axios from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

// const getApiUrl = () => {
//   if (process.env.EXPO_PUBLIC_API_URL) {
//     return process.env.EXPO_PUBLIC_API_URL;
//   }
// };
// export const axiosInstance = axios.create({
//   baseURL: getApiUrl(),
//   headers: {
//     "Content-Type": "application/json",
//   },
//   timeout: 10000, 
// });
// export const API_BASE_URL = axiosInstance;





const getApiUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    console.log('[API] Using EXPO_PUBLIC_API_URL:', process.env.EXPO_PUBLIC_API_URL);
    return process.env.EXPO_PUBLIC_API_URL;
  }

  if (Platform.OS !== "web") {
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const ip = hostUri.split(":")[0];
      const url = `http://${ip}:3000/api/v1`;
      console.log('[API] Auto-detected local backend from Metro hostUri:', url);
      return url;
    }
  }

  if (Platform.OS === "web") {
    const url = `http://localhost:3000/api/v1`;
    console.log('[API] Web browser backend:', url);
    return url;
  }

  console.warn('[API] Could not detect backend URL, falling back to localhost');
  return "http://localhost:3000/api/v1";
};
// Main shared axios instance used across the app
export const axiosInstance = axios.create({
  baseURL: getApiUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});
export const API_BASE_URL = axiosInstance;