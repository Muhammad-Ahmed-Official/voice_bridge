import axios from "axios";
import { API_URL } from "./config.js";

export const axiosInstance = axios.create({
  baseURL: API_URL,
});