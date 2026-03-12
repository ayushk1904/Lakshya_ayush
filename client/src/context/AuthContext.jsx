import { createContext, useContext, useEffect, useState } from "react";
import { authApi } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("lakshya_token");

    if (!token) {
      setIsLoading(false);
      return;
    }

    authApi
      .me()
      .then((data) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem("lakshya_token");
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  async function login(credentials) {
    const data = await authApi.login(credentials);
    localStorage.setItem("lakshya_token", data.token);
    setUser(data.user);
    return data;
  }

  async function register(payload) {
    const data = await authApi.register(payload);
    localStorage.setItem("lakshya_token", data.token);
    setUser(data.user);
    return data;
  }

  async function requestPasswordOtp(payload) {
    return authApi.requestPasswordOtp(payload);
  }

  async function resetPasswordWithOtp(payload) {
    const data = await authApi.resetPasswordWithOtp(payload);
    localStorage.setItem("lakshya_token", data.token);
    setUser(data.user);
    return data;
  }

  function logout() {
    localStorage.removeItem("lakshya_token");
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: Boolean(user),
        login,
        register,
        requestPasswordOtp,
        resetPasswordWithOtp,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
