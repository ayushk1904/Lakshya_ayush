const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
const CONCEPT_EXPLAINER_URL = import.meta.env.VITE_CONCEPT_EXPLAINER_URL?.trim() || "";

function stripMarkdown(text = "") {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEasyExplanationFallback(answer = "") {
  const plainText = stripMarkdown(answer);

  if (!plainText) {
    return "";
  }

  const sentences = plainText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!sentences.length) {
    return "";
  }

  return ["## Easy Explanation", "", ...sentences.map((sentence) => `- ${sentence}`)].join("\n");
}

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
    throw new Error(data.message || data.error || "Request failed");
  }

  return data;
}

export const authApi = {
  login: (payload) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload) => apiRequest("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  updateProfile: (payload) => apiRequest("/auth/profile", { method: "PUT", body: JSON.stringify(payload) }),
  requestPasswordOtp: (payload) =>
    apiRequest("/auth/forgot-password/request-otp", { method: "POST", body: JSON.stringify(payload) }),
  resetPasswordWithOtp: (payload) =>
    apiRequest("/auth/forgot-password/reset", { method: "POST", body: JSON.stringify(payload) }),
  me: () => apiRequest("/auth/me")
};

export const studyPlanApi = {
  fromPdf: (formData) =>
    fetch(`${API_BASE_URL}/study-plans/from-pdf`, {
      method: "POST",
      body: formData
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.error || "PDF API error");
      }

      return data;
    }),
  generate: (payload) => apiRequest("/study-plans/generate-plan", { method: "POST", body: JSON.stringify(payload) }),
  today: () => apiRequest("/study-plans/today-plan"),
  lastMinute: () => apiRequest("/study-plans/last-minute"),
  startVoiceRevision: (payload) => apiRequest("/study-plans/voice-revision/start", { method: "POST", body: JSON.stringify(payload) }),
  evaluateVoiceRevision: (payload) =>
    apiRequest("/study-plans/voice-revision/evaluate", { method: "POST", body: JSON.stringify(payload) })
};

export const chatApi = {
  listRooms: () => apiRequest("/chat-rooms"),
  createRoom: (payload) => apiRequest("/chat-rooms", { method: "POST", body: JSON.stringify(payload) }),
  roomMessages: (roomId) => apiRequest(`/chat-rooms/${roomId}/messages`),
  updateRoomSettings: (roomId, payload) => apiRequest(`/chat-rooms/${roomId}/settings`, { method: "PUT", body: JSON.stringify(payload) }),
  leaveRoom: (roomId) => apiRequest(`/chat-rooms/${roomId}/leave`, { method: "POST" }),
  deleteRoom: (roomId) => apiRequest(`/chat-rooms/${roomId}`, { method: "DELETE" }),
  sendMessage: (roomId, payload) => apiRequest(`/chat-rooms/${roomId}/messages`, { method: "POST", body: JSON.stringify(payload) }),
  deleteMessage: (roomId, messageId, payload) =>
    apiRequest(`/chat-rooms/${roomId}/messages/${messageId}/delete`, { method: "POST", body: JSON.stringify(payload) }),
  inviteByEmail: (roomId, payload) =>
    apiRequest(`/chat-rooms/${roomId}/invitations`, { method: "POST", body: JSON.stringify(payload) }),
  listInvitations: () => apiRequest(`/chat-rooms/invitations`),
  previewJoin: (code) => apiRequest(`/chat-rooms/join/${encodeURIComponent(code)}`),
  joinByCode: (code) => apiRequest(`/chat-rooms/join/${encodeURIComponent(code)}`, { method: "POST" }),
  acceptInvitation: (roomId) => apiRequest(`/chat-rooms/${roomId}/invitations/accept`, { method: "POST" }),
  rejectInvitation: (roomId) => apiRequest(`/chat-rooms/${roomId}/invitations/reject`, { method: "POST" })
};

function getAuthHeaders(headers = {}) {
  const token = localStorage.getItem("lakshya_token");

  if (!token) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${token}`
  };
}

async function fetchBuiltinConceptExplainerVideos(question) {
  const query = String(question || "").trim();

  if (!query) {
    return [];
  }

  const response = await fetch(
    `${API_BASE_URL}/concept-explainer/videos?question=${encodeURIComponent(query)}`,
    {
      headers: getAuthHeaders()
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || "Failed to fetch related videos");
  }

  return data.videos || [];
}

function buildConceptExplainerUrl(path) {
  if (!CONCEPT_EXPLAINER_URL) {
    return `${API_BASE_URL}/concept-explainer${path}`;
  }

  return `${CONCEPT_EXPLAINER_URL.replace(/\/$/, "")}${path}`;
}

async function parseResponseOrThrow(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || fallbackMessage);
  }

  return data;
}

async function fetchBuiltinConceptDocuments() {
  const response = await fetch(`${API_BASE_URL}/concept-explainer/documents`, {
    headers: getAuthHeaders()
  });

  return parseResponseOrThrow(response, "Failed to list documents");
}

async function uploadBuiltinConceptDocument(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/concept-explainer/documents`, {
    method: "POST",
    body: formData,
    headers: getAuthHeaders()
  });

  return parseResponseOrThrow(response, "Upload failed");
}

async function deleteBuiltinConceptDocument(documentId) {
  const response = await fetch(`${API_BASE_URL}/concept-explainer/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers: getAuthHeaders()
  });

  return parseResponseOrThrow(response, "Delete failed");
}

function normalizeConceptDocument(document = {}, index = 0) {
  const fallbackId = document._id || document.id || document.documentId || document.filename || `concept-document-${index}`;

  return {
    _id: fallbackId,
    fileName: document.fileName || document.filename || `Uploaded document ${index + 1}`,
    mimeType: document.mimeType || "application/pdf",
    uploadedAt: document.uploadedAt || document.createdAt || null
  };
}

async function fetchCustomConceptDocuments() {
  const response = await conceptExplainerRequest({
    customPath: "/documents",
    builtinPath: "/documents",
    options: {
      headers: undefined
    }
  });

  const data = await parseResponseOrThrow(response, "Failed to list documents");
  return {
    documents: (data.documents || []).map((document, index) => normalizeConceptDocument(document, index))
  };
}

async function uploadCustomConceptDocument(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await conceptExplainerRequest({
    customPath: "/upload",
    builtinPath: "/documents",
    options: {
      method: "POST",
      body: formData,
      headers: undefined
    }
  });

  const data = await parseResponseOrThrow(response, "Upload failed");

  return {
    document: normalizeConceptDocument(
      {
        ...data,
        fileName: data.fileName || data.filename || file.name,
        mimeType: data.mimeType || file.type || "application/pdf"
      },
      0
    )
  };
}

async function deleteCustomConceptDocument(identifier) {
  const value = String(identifier || "").trim();

  if (!value) {
    return { success: true };
  }

  const response = await conceptExplainerRequest({
    customPath: `/documents/${encodeURIComponent(value)}`,
    builtinPath: `/documents/${encodeURIComponent(value)}`,
    options: {
      method: "DELETE",
      headers: undefined
    }
  });

  return parseResponseOrThrow(response, "Delete failed");
}

function isNetworkFetchError(error) {
  if (!error) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  return message.includes("failed to fetch") || message.includes("load failed") || message.includes("networkerror");
}

function buildConceptExplainerUnavailableMessage() {
  if (!CONCEPT_EXPLAINER_URL) {
    return "Concept explainer service is unavailable right now.";
  }

  return `Your personal Concept Explainer service at ${CONCEPT_EXPLAINER_URL} is unavailable right now. Start it and try again.`;
}

export function getConceptExplainerAssetBaseUrl() {
  if (CONCEPT_EXPLAINER_URL) {
    return CONCEPT_EXPLAINER_URL.replace(/\/$/, "");
  }

  if (/^https?:\/\//i.test(API_BASE_URL)) {
    return API_BASE_URL.replace(/\/api\/?$/, "");
  }

  return window.location.origin;
}

async function conceptExplainerRequest({ customPath, builtinPath, options = {} }) {
  const builtinUrl = `${API_BASE_URL}/concept-explainer${builtinPath}`;

  if (!CONCEPT_EXPLAINER_URL) {
    return fetch(builtinUrl, options);
  }

  try {
    return await fetch(buildConceptExplainerUrl(customPath), options);
  } catch (error) {
    if (isNetworkFetchError(error)) {
      throw new Error(buildConceptExplainerUnavailableMessage());
    }

    throw error;
  }
}

export const conceptExplainerApi = {
  listDocuments: () => fetchBuiltinConceptDocuments(),
  uploadDocument: (file) => uploadBuiltinConceptDocument(file),
  deleteDocument: async (document) => {
    const targetDocument =
      typeof document === "string"
        ? {
            _id: document
          }
        : document || {};

    return deleteBuiltinConceptDocument(targetDocument._id);
  },
  startGame: (payload = {}) =>
    fetch(`${API_BASE_URL}/concept-explainer/game`, {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        questionCount: payload.questionCount || 5,
        documentIds: payload.documentIds || []
      })
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.error || "Game failed");
      }

      return {
        quiz: data.quiz || { title: "PDF Quiz Challenge", questions: [] },
        warning: data.warning || ""
      };
    }),
  askQuestion: (payload) =>
    conceptExplainerRequest({
      customPath: "/ask",
      builtinPath: "/ask",
      options: {
        method: "POST",
        headers: CONCEPT_EXPLAINER_URL ? { "Content-Type": "application/json" } : getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(
          CONCEPT_EXPLAINER_URL
            ? { question: payload.question }
            : {
                question: payload.question,
                documentIds: payload.documentIds
              }
        )
      }
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.error || "Question failed");
      }

      const answer = data.answer || "";
      let videos = data.videos || [];

      if (CONCEPT_EXPLAINER_URL && !videos.length) {
        try {
          videos = await fetchBuiltinConceptExplainerVideos(payload.question);
        } catch (_error) {
          videos = [];
        }
      }

      return {
        answer,
        easyExplanation: data.easyExplanation || buildEasyExplanationFallback(answer),
        videos,
        warning: CONCEPT_EXPLAINER_URL ? data.sources || "" : data.warning || "",
        diagram: data.diagram || null,
        images: data.images || []
      };
    })
};

export const answerEvaluatorApi = {
  evaluate: (formData) =>
    fetch(`${API_BASE_URL}/answer-evaluator/evaluate`, {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Bearer ${localStorage.getItem("lakshya_token") || ""}`
      }
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Evaluation failed");
      }

      return data;
    })
};

// The local practice-test model only exists on a developer machine; in production every call goes to the backend.
const PRACTICE_AI_URL = import.meta.env.VITE_PRACTICE_AI_URL?.trim() || (import.meta.env.DEV ? "http://localhost:5000" : "");
const PRACTICE_PAPER_HIDDEN_STORAGE_KEY = "lakshya_hidden_practice_papers";

async function practiceAiRequest(path, options = {}) {
  if (!PRACTICE_AI_URL) {
    throw new Error("Practice test model is not configured");
  }

  const response = await fetch(`${PRACTICE_AI_URL}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || "Practice test service request failed");
  }

  return data;
}

function normalizePaperRecord(paper = {}, index = 0) {
  const normalizedId = paper._id || paper.id || paper.documentId || paper.filename || `practice-paper-${index}`;

  return {
    _id: normalizedId,
    id: paper.id || "",
    documentId: paper.documentId || "",
    filename: paper.filename || "",
    fileName: paper.fileName || paper.filename || `Uploaded paper ${index + 1}`,
    mimeType: paper.mimeType || "application/pdf",
    uploadedAt: paper.uploadedAt || paper.createdAt || null,
    diagramCount: paper.diagramCount || 0
  };
}

function normalizePaperKey(value) {
  return String(value || "").trim().toLowerCase();
}

function readHiddenPracticePaperKeys() {
  try {
    const raw = localStorage.getItem(PRACTICE_PAPER_HIDDEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizePaperKey).filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

function writeHiddenPracticePaperKeys(keys) {
  localStorage.setItem(PRACTICE_PAPER_HIDDEN_STORAGE_KEY, JSON.stringify(Array.from(new Set(keys.map(normalizePaperKey).filter(Boolean)))));
}

function buildPracticePaperKeys(paper = {}) {
  return Array.from(
    new Set(
      [paper._id, paper.id, paper.documentId, paper.filename, paper.fileName]
        .map(normalizePaperKey)
        .filter(Boolean)
    )
  );
}

function isHiddenPracticePaper(paper, hiddenKeys) {
  const paperKeys = buildPracticePaperKeys(paper);
  return paperKeys.some((key) => hiddenKeys.includes(key));
}

function hidePracticePaper(paper) {
  const hiddenKeys = readHiddenPracticePaperKeys();
  writeHiddenPracticePaperKeys([...hiddenKeys, ...buildPracticePaperKeys(paper)]);
}

function unhidePracticePaper(paper) {
  const hiddenKeys = readHiddenPracticePaperKeys();
  const paperKeys = new Set(buildPracticePaperKeys(paper));
  writeHiddenPracticePaperKeys(hiddenKeys.filter((key) => !paperKeys.has(key)));
}

export const examApi = {
  listPapers: async () => {
    const hiddenKeys = readHiddenPracticePaperKeys();

    try {
      const data = await practiceAiRequest("/documents");
      const papers = (data.documents || data.papers || []).map((paper, index) => normalizePaperRecord(paper, index));

      return {
        papers: papers.filter((paper) => !isHiddenPracticePaper(paper, hiddenKeys))
      };
    } catch (_error) {
      const data = await apiRequest("/exam-sessions/papers");
      const papers = (data.papers || []).map((paper, index) => normalizePaperRecord(paper, index));

      return {
        papers: papers.filter((paper) => !isHiddenPracticePaper(paper, hiddenKeys))
      };
    }
  },

  uploadPapers: async (formData) => {
    try {
      const files = formData.getAll("files");
      const uploaded = [];

      for (const file of files) {
        const payload = new FormData();
        payload.append("file", file);

        const data = await practiceAiRequest("/upload-practice-paper", {
          method: "POST",
          body: payload
        });

        uploaded.push(
          normalizePaperRecord(
            {
              ...data,
              fileName: data.fileName || data.filename || file.name,
              mimeType: data.mimeType || file.type || "application/pdf"
            },
            uploaded.length
          )
        );
        unhidePracticePaper(uploaded[uploaded.length - 1]);
      }

      return { papers: uploaded };
    } catch (_error) {
      const data = await fetch(`${API_BASE_URL}/exam-sessions/papers`, {
        method: "POST",
        body: formData,
        headers: getAuthHeaders()
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(body.message || body.error || "Upload failed");
        }

        return body;
      });

      return {
        papers: (data.papers || (data.paper ? [data.paper] : [])).map((paper, index) => normalizePaperRecord(paper, index)).map((paper) => {
          unhidePracticePaper(paper);
          return paper;
        })
      };
    }
  },

  deletePaper: async (paper) => {
    const targetPaper =
      typeof paper === "string"
        ? {
            _id: paper
          }
        : paper || {};

    const candidateIds = Array.from(
      new Set(
        [
          targetPaper._id,
          targetPaper.id,
          targetPaper.documentId,
          targetPaper.filename,
          targetPaper.fileName
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );

    let lastError = null;

    for (const candidateId of candidateIds) {
      try {
        const result = await practiceAiRequest(`/documents/${encodeURIComponent(candidateId)}`, { method: "DELETE" });
        hidePracticePaper(targetPaper);
        return result;
      } catch (error) {
        lastError = error;
        const message = String(error.message || "").toLowerCase();

        if (message.includes("not found")) {
          break;
        }
      }
    }

    for (const candidateId of candidateIds) {
      try {
        const result = await apiRequest(`/exam-sessions/papers/${encodeURIComponent(candidateId)}`, { method: "DELETE" });
        hidePracticePaper(targetPaper);
        return result;
      } catch (error) {
        lastError = error;
        const message = String(error.message || "").toLowerCase();

        if (!message.includes("not found")) {
          throw error;
        }
      }
    }

    const lastMessage = String(lastError?.message || "").toLowerCase();

    if (lastMessage.includes("not found")) {
      hidePracticePaper(targetPaper);
      return { success: true, hidden: true };
    }

    throw lastError || new Error("Paper not found");
  },

  generateTest: async (payload) => {
    try {
      const generated = await practiceAiRequest("/generate-practice-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const generatedTest =
        generated.generatedTest ||
        generated.paper ||
        generated.test ||
        generated.markdown ||
        generated.content ||
        "";

      if (!String(generatedTest).trim()) {
        throw new Error("Your practice-test model did not return a generated paper.");
      }

      return apiRequest("/exam-sessions/generate-test", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          generatedTest
        })
      });
    } catch (_error) {
      return apiRequest("/exam-sessions/generate-test", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
  },

  upcoming: () => apiRequest("/exam-sessions/upcoming"),
  active: () => apiRequest("/exam-sessions/active"),
  start: (payload) => apiRequest("/exam-sessions/start", { method: "POST", body: JSON.stringify(payload) }),
  autoStartSession: (sessionId) => apiRequest(`/exam-sessions/${sessionId}/auto-start`, { method: "POST" }),
  acceptCall: (sessionId) => apiRequest(`/exam-sessions/${sessionId}/accept-call`, { method: "POST" }),
  declineCall: (sessionId) => apiRequest(`/exam-sessions/${sessionId}/decline-call`, { method: "POST" }),
  deleteSession: (sessionId) => apiRequest(`/exam-sessions/${sessionId}`, { method: "DELETE" }),
  shareToRoom: (sessionId, payload) =>
    apiRequest(`/exam-sessions/${sessionId}/share-to-room`, { method: "POST", body: JSON.stringify(payload) }),
  proctorFrame: (sessionId, payload) =>
    apiRequest(`/exam-sessions/${sessionId}/proctor-frame`, { method: "POST", body: JSON.stringify(payload) }),
  proctorAlert: (sessionId, payload) =>
    apiRequest(`/exam-sessions/${sessionId}/proctor-alert`, { method: "POST", body: JSON.stringify(payload) }),
  finishSession: (sessionId, payload) =>
    apiRequest(`/exam-sessions/${sessionId}/finish`, { method: "POST", body: JSON.stringify(payload) }),
  leaveSession: (sessionId) => apiRequest(`/exam-sessions/${sessionId}/leave`, { method: "POST" })
};

async function plannerUpload(path, formData) {
  const response = await fetch(`${API_BASE_URL}/study-planner${path}`, {
    method: "POST",
    body: formData,
    headers: getAuthHeaders()
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || "Upload failed");
  }

  return data;
}

export const studyPlannerApi = {
  library: () => apiRequest("/study-planner/library"),
  uploadSyllabus: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return plannerUpload("/syllabi", formData);
  },
  deleteSyllabus: (id) => apiRequest(`/study-planner/syllabi/${id}`, { method: "DELETE" }),
  retrySyllabus: (id) => apiRequest(`/study-planner/syllabi/${id}/retry`, { method: "POST" }),
  uploadPapers: (files) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    return plannerUpload("/papers", formData);
  },
  deletePaper: (id) => apiRequest(`/study-planner/papers/${id}`, { method: "DELETE" }),
  generatePlan: (payload) => apiRequest("/study-planner/plan", { method: "POST", body: JSON.stringify(payload) }),
  latestPlan: () => apiRequest("/study-planner/plans/latest")
};

export function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const progressApi = {
  summary: () => apiRequest(`/progress/summary?today=${localDayKey()}`),
  // keepalive lets the final heartbeat survive a tab close or navigation.
  addTime: (feature, minutes) =>
    apiRequest("/progress/time", {
      method: "POST",
      keepalive: true,
      body: JSON.stringify({ feature, minutes, day: localDayKey() })
    })
};

// Fire-and-forget: progress logging must never break the feature that reports it.
export function trackStudyEvent({ feature, type = "activity", score, label = "" }) {
  if (!localStorage.getItem("lakshya_token")) {
    return;
  }

  apiRequest("/progress/events", {
    method: "POST",
    body: JSON.stringify({ feature, type, score, label, day: localDayKey() })
  }).catch(() => {});
}
