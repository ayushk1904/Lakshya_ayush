import { createContext, useContext, useEffect, useState } from "react";
import { authApi } from "../api/client";

const AuthContext = createContext(null);

function getAvatarStorageKey(user) {
  if (!user) {
    return null;
  }

  return `lakshya_avatar_${user._id || user.email || user.name}`;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState(null);

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

  useEffect(() => {
    const avatarStorageKey = getAvatarStorageKey(user);

    if (!avatarStorageKey) {
      setAvatarUrl(null);
      return;
    }

    setAvatarUrl(localStorage.getItem(avatarStorageKey));
  }, [user]);

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

  async function updateProfile(payload) {
    const previousAvatarStorageKey = getAvatarStorageKey(user);
    const previousAvatarUrl = previousAvatarStorageKey ? localStorage.getItem(previousAvatarStorageKey) : null;
    const data = await authApi.updateProfile(payload);

    localStorage.setItem("lakshya_token", data.token);
    setUser(data.user);

    const nextAvatarStorageKey = getAvatarStorageKey(data.user);
    if (previousAvatarStorageKey && nextAvatarStorageKey && previousAvatarStorageKey !== nextAvatarStorageKey && previousAvatarUrl) {
      localStorage.setItem(nextAvatarStorageKey, previousAvatarUrl);
      localStorage.removeItem(previousAvatarStorageKey);
    }

    return data;
  }

  async function setAvatarFromFile(fileOrDataUrl) {
    if (!fileOrDataUrl) {
      return null;
    }

    const avatarStorageKey = getAvatarStorageKey(user);
    if (!avatarStorageKey) {
      return null;
    }

    const nextAvatarUrl =
      typeof fileOrDataUrl === "string"
        ? fileOrDataUrl
        : await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => reject(new Error("Unable to read image file"));
            reader.readAsDataURL(fileOrDataUrl);
          });

    if (!nextAvatarUrl) {
      throw new Error("Unable to load image preview");
    }

    localStorage.setItem(avatarStorageKey, nextAvatarUrl);
    setAvatarUrl(nextAvatarUrl);
    return nextAvatarUrl;
  }

  function clearAvatar() {
    const avatarStorageKey = getAvatarStorageKey(user);
    if (!avatarStorageKey) {
      return;
    }

    localStorage.removeItem(avatarStorageKey);
    setAvatarUrl(null);
  }

  function logout() {
    localStorage.removeItem("lakshya_token");
    setUser(null);
    setAvatarUrl(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        avatarUrl,
        isLoading,
        isAuthenticated: Boolean(user),
        login,
        register,
        updateProfile,
        requestPasswordOtp,
        resetPasswordWithOtp,
        setAvatarFromFile,
        clearAvatar,
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
