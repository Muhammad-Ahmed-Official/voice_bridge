import { createContext, useContext, useEffect, useState } from "react";
import { axiosInstance } from '../api/axios.js';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (_) {}
    }
    setLoading(false);
  }, []);

  const login = async (userId, password) => {
    setLoginLoading(true);
    try {
      const res = await axiosInstance.post("auth/signin", { userId, password });
      const data = res.data;

      if (!data.status) {
        return { success: false, message: data.message || "Login failed" };
      }

      const userData = data.user || { userId, name: userId };
      setUser(userData);
      localStorage.setItem("user", JSON.stringify(userData));
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || error.message || "Login failed";
      return { success: false, message };
    } finally {
      setLoginLoading(false);
    }
  };

  const register = async (userId, password) => {
    try {
      const res = await axiosInstance.post("auth/signup", { userId, password });
      const data = res.data;
      if (!data.status) {
        return { success: false, message: data.message || "Registration failed" };
      }
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || error.message || "Registration failed";
      return { success: false, message };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("user");
  };

  const value = {
    user,
    loading,
    loginLoading,
    login,
    register,
    logout,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};