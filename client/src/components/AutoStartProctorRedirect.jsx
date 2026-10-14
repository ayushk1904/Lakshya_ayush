import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { examApi } from "../api/client";
import { useAuth } from "../context/AuthContext";

function findDueSession(sessions) {
  const now = Date.now();
  const dueWindowMs = 15 * 60 * 1000;

  return (sessions || []).find((session) => {
    if (session?.status !== "scheduled" || !session?.startAt) {
      return false;
    }

    const startAt = new Date(session.startAt).getTime();

    if (Number.isNaN(startAt)) {
      return false;
    }

    return now >= startAt && now <= startAt + dueWindowMs;
  });
}

function AutoStartProctorRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const pollingRef = useRef(null);
  const startingSessionIdRef = useRef("");

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    async function syncSessionState() {
      try {
        const [upcomingData, activeData] = await Promise.all([examApi.upcoming(), examApi.active()]);
        const activeSession = activeData?.session || null;

        if (activeSession?.status === "active" && activeSession?.callAcceptedAt) {
          startingSessionIdRef.current = "";

          if (location.pathname !== "/app/proctor") {
            navigate("/app/proctor", { replace: true });
          }

          return;
        }

        const dueSession = findDueSession(upcomingData?.exams || []);

        if (!dueSession?._id || startingSessionIdRef.current === dueSession._id) {
          return;
        }

        startingSessionIdRef.current = dueSession._id;

        try {
          await examApi.autoStartSession(dueSession._id);
          navigate("/app/proctor", { replace: true });
        } catch {
          startingSessionIdRef.current = "";
        }
      } catch {
        // Ignore transient polling failures.
      }
    }

    syncSessionState();
    pollingRef.current = window.setInterval(syncSessionState, 3000);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isAuthenticated, location.pathname, navigate]);

  return null;
}

export default AutoStartProctorRedirect;
