const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("lakshya_token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export const authApi = {
  login: (payload) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload) => apiRequest("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  me: () => apiRequest("/auth/me")
};

export const studyPlanApi = {
  today: () => apiRequest("/study-plans/today"),
  generate: (payload) => apiRequest("/study-plans/generate", { method: "POST", body: JSON.stringify(payload) }),
  lastMinute: () => apiRequest("/study-plans/last-minute")
};

export const chatApi = {
  listRooms: () => apiRequest("/chat-rooms"),
  roomMessages: (roomId) => apiRequest(`/chat-rooms/${roomId}/messages`),
  sendMessage: (roomId, payload) => apiRequest(`/chat-rooms/${roomId}/messages`, { method: "POST", body: JSON.stringify(payload) })
};

export const examApi = {
  upcoming: () => apiRequest("/exam-sessions/upcoming"),
  active: () => apiRequest("/exam-sessions/active"),
  start: (payload) => apiRequest("/exam-sessions/start", { method: "POST", body: JSON.stringify(payload) })
};
