import { BellRing, Phone, PhoneOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { examApi } from "../api/client";
import lakshyaAiLogo from "../assets/lakshya-ai-logo.png";
import { useAuth } from "../context/AuthContext";

const POLL_MS = 3000;
const RING_WINDOW_MS = 15 * 60 * 1000; // matches the server's window for accepting a due test
const RING_TIMEOUT_MS = 60 * 1000; // after a minute unanswered the call shows as missed
const RINGTONE_URL = "/incoming-call.mp3";

function findDueSession(sessions) {
  const now = Date.now();

  return (sessions || []).find((session) => {
    if (session?.status !== "scheduled" || !session?.startAt) {
      return false;
    }

    const startAt = new Date(session.startAt).getTime();
    return !Number.isNaN(startAt) && now >= startAt && now <= startAt + RING_WINDOW_MS;
  });
}

// Rings like a phone call when a scheduled practice test is due. Accept opens the proctored test;
// decline skips it. Mounted once in AppLayout so the call reaches the student on any page.
function IncomingTestCall() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [call, setCall] = useState(null); // { session, state: "ringing" | "missed" }
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const audioRef = useRef(null);
  const handledIdsRef = useRef(new Set());
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  const stopRinging = useCallback(() => {
    audioRef.current?.pause();
    if (navigator.vibrate) {
      navigator.vibrate(0);
    }
  }, []);

  const startRinging = useCallback(async () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(RINGTONE_URL);
      audioRef.current.loop = true;
    }

    try {
      audioRef.current.currentTime = 0;
      await audioRef.current.play();
      setSoundBlocked(false);
    } catch {
      // Browsers block sound until the page has been clicked at least once.
      setSoundBlocked(true);
    }

    if (navigator.vibrate) {
      navigator.vibrate([800, 400, 800, 400, 800]);
    }
  }, []);

  // Poll for a due test (and send already-accepted tests straight to the proctor page).
  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    async function sync() {
      try {
        const [upcomingData, activeData] = await Promise.all([examApi.upcoming(), examApi.active()]);
        const activeSession = activeData?.session || null;

        if (activeSession?.status === "active" && activeSession?.callAcceptedAt) {
          if (pathnameRef.current !== "/app/proctor") {
            navigate("/app/proctor", { replace: true });
          }
          return;
        }

        const dueSession = findDueSession(upcomingData?.exams || []);
        if (dueSession?._id && !handledIdsRef.current.has(dueSession._id)) {
          handledIdsRef.current.add(dueSession._id);
          setError("");
          setCall({ session: dueSession, state: "ringing" });
        }
      } catch {
        // Ignore transient polling failures.
      }
    }

    sync();
    const intervalId = window.setInterval(sync, POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, navigate]);

  // While ringing: ringtone, vibration, flashing tab title, a system notification if the tab is in
  // the background, and a timeout that turns the call into a missed call.
  useEffect(() => {
    if (call?.state !== "ringing") {
      return undefined;
    }

    startRinging();

    const originalTitle = document.title;
    let flash = false;
    const titleTimer = window.setInterval(() => {
      flash = !flash;
      document.title = flash ? "📞 Incoming test call" : originalTitle;
    }, 1000);

    let notification = null;
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      notification = new Notification("Incoming test call", {
        body: `${call.session.title || "Practice test"} is ready. Open Lakshya to accept.`,
        icon: lakshyaAiLogo,
        requireInteraction: true
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }

    const missedTimer = window.setTimeout(() => {
      setCall((current) => (current ? { ...current, state: "missed" } : current));
    }, RING_TIMEOUT_MS);

    return () => {
      stopRinging();
      window.clearInterval(titleTimer);
      window.clearTimeout(missedTimer);
      document.title = originalTitle;
      notification?.close();
    };
  }, [call?.state, call?.session, startRinging, stopRinging]);

  useEffect(() => stopRinging, [stopRinging]);

  async function acceptCall() {
    if (!call || busy) {
      return;
    }

    setBusy("accept");
    setError("");
    stopRinging();

    try {
      await examApi.acceptCall(call.session._id);
      setCall(null);
      navigate("/app/proctor", { replace: true });
    } catch (acceptError) {
      setError(acceptError.message || "Could not start the test. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function declineCall() {
    if (!call || busy) {
      return;
    }

    setBusy("decline");
    setError("");
    stopRinging();

    try {
      await examApi.declineCall(call.session._id);
      setCall(null);
    } catch (declineError) {
      setError(declineError.message || "Could not decline the call. Please try again.");
    } finally {
      setBusy("");
    }
  }

  if (!call) {
    return null;
  }

  const { session, state } = call;
  const isRinging = state === "ringing";

  return (
    <div className="test-call-overlay" role="dialog" aria-modal="true" aria-labelledby="test-call-title">
      <div className={`test-call-card ${isRinging ? "is-ringing" : "is-missed"}`}>
        <span className="test-call-kicker">
          <BellRing size={14} />
          {isRinging ? "Incoming test call" : "Missed test call"}
        </span>

        <div className="test-call-avatar">
          <span className="test-call-pulse" aria-hidden="true" />
          <span className="test-call-pulse test-call-pulse-delayed" aria-hidden="true" />
          <img src={lakshyaAiLogo} alt="" />
        </div>

        <h2 id="test-call-title">{session.title || "Practice Test"}</h2>
        <p className="test-call-caller">Lakshya AI Proctor</p>
        <p className="test-call-meta">{`${session.marks || 80} marks · ${session.durationMinutes || 60} minutes`}</p>

        {isRinging && soundBlocked ? (
          <button className="test-call-sound" type="button" onClick={startRinging}>
            <Volume2 size={16} />
            Tap to turn on ringtone
          </button>
        ) : null}

        {error ? <p className="test-call-error">{error}</p> : null}

        <div className="test-call-actions">
          <div className="test-call-action">
            <button className="test-call-button is-decline" type="button" onClick={declineCall} disabled={Boolean(busy)} aria-label="Decline test call">
              <PhoneOff size={26} />
            </button>
            <span>{busy === "decline" ? "Declining..." : isRinging ? "Decline" : "Dismiss"}</span>
          </div>
          <div className="test-call-action">
            <button className="test-call-button is-accept" type="button" onClick={acceptCall} disabled={Boolean(busy)} aria-label="Accept test call">
              <Phone size={26} />
            </button>
            <span>{busy === "accept" ? "Connecting..." : isRinging ? "Accept" : "Start test now"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default IncomingTestCall;
