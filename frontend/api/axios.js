import axios from "axios";
const BASE_URL = "https://voice-bridge-pfzq4vdxj-muhammadahmedanis-projects.vercel.app/api/v1";

export const axiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});


// import axios from "axios";
// import Constants from "expo-constants";
// import { Platform } from "react-native";

// function getBaseUrl() {
//   if (Platform.OS === "web") {
//     return "https://voice-bridge-pfzq4vdxj-muhammadahmedanis-projects.vercel.app/api/v1/";
//   }

//   // For mobile: extract IP from Expo's hostUri (e.g., "192.168.0.105:8081")
//   const hostUri = Constants.expoConfig?.hostUri;
//   if (hostUri) {
//     const ip = hostUri.split(":")[0];
//     console.log("[API] Using backend IP:", ip);
//     return `http://${ip}:3000/api/v1/`;
//   }

//   // Fallback
//   return "https://voice-bridge-pfzq4vdxj-muhammadahmedanis-projects.vercel.app/api/v1/";
// }

// export const axiosInstance = axios.create({
//   baseURL: getBaseUrl(),
// });

