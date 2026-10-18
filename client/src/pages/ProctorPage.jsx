import { BellRing, Camera, Mic, ScanEye, ScanFace, Users, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate } from "react-router-dom";
import { examApi, trackStudyEvent } from "../api/client";
import ExamPaper from "../components/ExamPaper";
import { useAuth } from "../context/AuthContext";

const ALERT_LINES = [
  "No cheating, focus on your paper.",
  "Please keep your attention on the answer sheet.",
  "Stay focused. Your exam is being monitored.",
  "Eyes on the paper. Continue writing honestly."
];

function pickAlert(index) {
  return ALERT_LINES[index % ALERT_LINES.length];
}

// Computer-vision proctoring (proctor-ai service): one small frame every few seconds.
// Strict mode: frequent checks, a warning once an issue repeats in 2 of the last 3 frames, and
// a short cooldown. Frames are 1280 px so phones and books stay detectable.
const VISION_INTERVAL_MS = 2000;
const VISION_RETRY_MS = 10000;
const VISION_FRAME_WIDTH = 1280;
const CALIBRATION_FRAMES = 4;
const ISSUE_WINDOW = 3;
const ISSUE_REPEATS = 2;
const ALERT_COOLDOWN_MS = 8000;
const ATTENTION_WINDOW = 24;

const GAZE_LABELS = {
  screen: "Screen",
  down: "Your paper",
  sideways: "Away (sideways)",
  up: "Looking up",
  away: "Turned away",
  unknown: "Not visible"
};

const TURNED_AWAY_ISSUE = {
  code: "turned_away",
  severity: "warning",
  message: "Do not turn away from your exam. Face the screen or your paper."
};

function escalate(message, strike) {
  if (strike === 1) {
    return message;
  }
  if (strike === 2) {
    return `Second warning. ${message}`;
  }
  return `Final warning. ${message} This is being recorded.`;
}

const BOX_COLORS = {
  face: "#22c55e",
  person: "#60a5fa",
  "cell phone": "#ef4444",
  book: "#2dd4bf",
  laptop: "#a78bfa"
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Draws the service's boxes over the camera preview, which is mirrored and object-fit: cover.
function drawDetections(overlay, video, detections, gaze) {
  if (!overlay || !video?.videoWidth) {
    return;
  }

  const width = overlay.clientWidth;
  const height = overlay.clientHeight;
  overlay.width = width;
  overlay.height = height;

  const context = overlay.getContext("2d");
  context.clearRect(0, 0, width, height);

  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const drawnWidth = video.videoWidth * scale;
  const drawnHeight = video.videoHeight * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;

  context.lineWidth = 2;
  context.font = "600 12px system-ui, sans-serif";

  detections.forEach((detection) => {
    const [x, y, w, h] = detection.box;
    const boxWidth = w * drawnWidth;
    const boxHeight = h * drawnHeight;
    const left = width - (offsetX + x * drawnWidth) - boxWidth;
    const top = offsetY + y * drawnHeight;
    const lookingAway = detection.label === "face" && (gaze === "sideways" || gaze === "up" || gaze === "away");
    const color = lookingAway ? "#f59e0b" : BOX_COLORS[detection.label] || "#e5e7eb";
    const caption = detection.label === "face" ? `face · ${GAZE_LABELS[gaze] || gaze}` : detection.label;

    context.strokeStyle = color;
    context.strokeRect(left, top, boxWidth, boxHeight);
    const textWidth = context.measureText(caption).width + 10;
    context.fillStyle = color;
    context.fillRect(left, Math.max(0, top - 18), textWidth, 18);
    context.fillStyle = "#0b1220";
    context.fillText(caption, left + 5, Math.max(13, top - 5));
  });
}

function formatStartTime(value) {
  if (!value) {
    return "Not scheduled";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatJoinedTime(value) {
  if (!value) {
    return "Joined";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Joined";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function ProctorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const raiseAlertRef = useRef(() => {});
  const streamRef = useRef(null);
  const speakingRef = useRef(false);
  const warningCountRef = useRef(0);
  const completionHandledRef = useRef(false);
  const spokenSessionRef = useRef("");
  const fiveMinuteWarningRef = useRef("");

  const [session, setSession] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [status, setStatus] = useState("Checking your exam call...");
  const [lastAlert, setLastAlert] = useState("No violations detected.");
  const [faceState, setFaceState] = useState("Waiting for camera permission.");
  const [mediaRequestKey, setMediaRequestKey] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [leaving, setLeaving] = useState(false);
  const [vision, setVision] = useState({ online: null, calibrating: true, result: null, attention: null, strikes: 0, error: "" });
  const hasAcceptedCall = session?.status === "active" && Boolean(session?.callAcceptedAt);
  const joinedParticipants = session?.sharedParticipants || [];
  const learnerName = String(user?.name || "").trim().split(/\s+/)[0] || "there";

  // One place that speaks a warning, shows it, and records it on the session. Long-lived effects
  // call it through raiseAlertRef so they always use the latest session.
  function raiseAlert(message, attentionScore) {
    setLastAlert(message);
    warningCountRef.current += 1;

    if ("speechSynthesis" in window && !speakingRef.current) {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 1;
      utterance.pitch = 0.95;
      utterance.onstart = () => {
        speakingRef.current = true;
      };
      utterance.onend = () => {
        speakingRef.current = false;
      };
      utterance.onerror = () => {
        speakingRef.current = false;
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }

    if (session?._id) {
      examApi
        .proctorAlert(session._id, { message, attentionScore })
        .then((data) => setSession((current) => data.session || current))
        .catch(() => {});
    }
  }
  raiseAlertRef.current = raiseAlert;

  function stopMediaStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  useEffect(() => {
    examApi
      .active()
      .then((data) => {
        setSession(data.session || null);
        if (data.session?.status === "active" && data.session?.callAcceptedAt) {
          setStatus("AI Proctor is active. Camera and focus checks are running.");
        } else if (data.session?.status === "scheduled" && data.session?.startAt) {
          setStatus("Your scheduled test will start automatically at the selected time.");
        } else {
          setStatus("No active proctor session yet. Generate and schedule a test first.");
        }
      })
      .catch(() => {
        setStatus("Could not load the current exam session.");
      });
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const refreshId = window.setInterval(() => {
      examApi
        .active()
        .then((data) => {
          setSession(data.session || null);
          if (data.session?.status === "active" && data.session?.callAcceptedAt) {
            setStatus("AI Proctor is active. Camera and focus checks are running.");
          } else if (data.session?.status === "scheduled" && data.session?.startAt) {
            setStatus("Your scheduled test will start automatically at the selected time.");
          } else {
            setStatus("No active proctor session yet. Generate and schedule a test first.");
          }
        })
        .catch(() => {});
    }, 15000);

    return () => window.clearInterval(refreshId);
  }, []);

  useEffect(() => {
    if (!hasAcceptedCall) {
      return undefined;
    }

    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setCameraReady(true);
        setMicReady(true);
        setFaceState("Camera active. Keep your face and writing posture visible.");
      } catch (_error) {
        setStatus("Camera or microphone access was blocked. Please allow access to start live proctoring.");
        setFaceState("Permission needed.");
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [hasAcceptedCall, mediaRequestKey]);

  useEffect(() => {
    if (!hasAcceptedCall || !session?._id || spokenSessionRef.current === session._id || !("speechSynthesis" in window)) {
      return;
    }

    spokenSessionRef.current = session._id;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(
      `Hey ${learnerName}. The test begins. Write your paper honestly. All the best.`
    );
    utterance.rate = 0.97;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => {
      speakingRef.current = true;
    };
    utterance.onend = () => {
      speakingRef.current = false;
    };
    utterance.onerror = () => {
      speakingRef.current = false;
    };

    const timeoutId = window.setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [hasAcceptedCall, learnerName, session?._id]);

  useEffect(() => {
    if (!hasAcceptedCall) {
      return undefined;
    }

    function announce(message, attentionScore) {
      raiseAlertRef.current(message, attentionScore);
    }

    function handleVisibility() {
      if (document.hidden) {
        announce(pickAlert(warningCountRef.current), 70);
      }
    }

    function handleBlur() {
      announce("Keep the exam window open and focus on your paper.", 74);
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
    };
  }, [hasAcceptedCall]);

  // Live computer-vision checks. The first few frontal frames calibrate the student's normal
  // "looking at the screen" pose; after that only the screen and the paper below are allowed.
  useEffect(() => {
    if (!hasAcceptedCall || !cameraReady || !session?._id) {
      return undefined;
    }

    const sessionId = session._id;
    const issueHistory = [];
    const focusHistory = [];
    const calibrationSamples = [];
    let baseline = null;
    let lastVisibleGaze = "screen";
    let lastVisionAlertAt = 0;
    let strikes = 0;
    let timerId = null;
    let cancelled = false;

    async function analyzeFrame() {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) {
        return VISION_INTERVAL_MS;
      }

      const frameWidth = Math.min(VISION_FRAME_WIDTH, video.videoWidth);
      canvas.width = frameWidth;
      canvas.height = Math.round((video.videoHeight * frameWidth) / video.videoWidth);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

      let result;
      try {
        ({ result } = await examApi.proctorFrame(sessionId, { image: canvas.toDataURL("image/jpeg", 0.75), baseline }));
      } catch (error) {
        // The vision service sleeps when idle on the free server; while it wakes it is "starting",
        // not offline, and frames are retried sooner.
        const starting = /starting up/i.test(error.message || "");
        if (!cancelled) {
          setVision((current) => ({ ...current, online: starting ? null : false, error: error.message }));
          setFaceState(starting ? "AI proctor is starting up. Tab-switch protection is already on." : "AI vision is offline. Tab-switch protection is still on.");
          drawDetections(overlayRef.current, video, [], "unknown");
        }
        return starting ? VISION_INTERVAL_MS * 2 : VISION_RETRY_MS;
      }

      if (cancelled) {
        return null;
      }

      // Calibrate only from frames where the student is roughly facing the camera, so a first
      // glance away can never become the "normal" pose.
      const head = result.head;
      const nearFrontal = head && Math.abs(head.yaw) < 0.2 && head.pitch > 0.35 && head.pitch < 0.85;
      if (!baseline && result.faces === 1 && result.people <= 1 && !result.phone && nearFrontal) {
        calibrationSamples.push(head);
        if (calibrationSamples.length >= CALIBRATION_FRAMES) {
          baseline = {
            yaw: median(calibrationSamples.map((sample) => sample.yaw)),
            pitch: median(calibrationSamples.map((sample) => sample.pitch))
          };
        }
      }

      // A face that vanishes right after turning sideways/up is still looking away; one that
      // vanishes after bending down is writing.
      const issues = [...result.issues];
      let gaze = result.gaze;
      if (gaze === "hidden") {
        if (lastVisibleGaze === "sideways" || lastVisibleGaze === "up") {
          gaze = "away";
          issues.push({ ...TURNED_AWAY_ISSUE });
        } else {
          gaze = "down";
        }
      } else if (gaze !== "unknown") {
        lastVisibleGaze = gaze;
      }
      const effective = {
        ...result,
        gaze,
        issues,
        status: issues.some((issue) => issue.severity === "violation") ? "violation" : issues.length ? "warning" : "focused"
      };

      issueHistory.push(issues.map((issue) => issue.code));
      issueHistory.splice(0, Math.max(0, issueHistory.length - ISSUE_WINDOW));
      focusHistory.push(effective.status === "focused");
      focusHistory.splice(0, Math.max(0, focusHistory.length - ATTENTION_WINDOW));
      const attention = Math.round((100 * focusHistory.filter(Boolean).length) / focusHistory.length);

      setVision((current) => ({ ...current, online: true, calibrating: !baseline, result: effective, attention, error: "" }));
      drawDetections(overlayRef.current, video, result.detections, gaze);

      if (!baseline) {
        setFaceState("Calibrating: look straight at your screen for a few seconds.");
      } else if (effective.status === "focused") {
        setFaceState(gaze === "down" ? "Writing posture looks good." : "Focused on the screen.");
      } else {
        setFaceState(issues[0]?.message || "Keep your eyes on the screen or your paper.");
      }

      // Strict: any issue seen in 2 of the last 3 frames (~4 s) is warned about, with escalating
      // wording. Gaze issues wait for calibration so the webcam angle itself is never punished.
      const persistentIssue = issues.find((issue) => {
        if (issue.severity !== "violation" && !baseline) {
          return false;
        }
        return issueHistory.filter((codes) => codes.includes(issue.code)).length >= ISSUE_REPEATS;
      });

      if (persistentIssue && Date.now() - lastVisionAlertAt > ALERT_COOLDOWN_MS) {
        lastVisionAlertAt = Date.now();
        strikes += 1;
        setVision((current) => ({ ...current, strikes }));
        raiseAlertRef.current(escalate(persistentIssue.message, strikes), Math.max(40, attention));
      }

      return VISION_INTERVAL_MS;
    }

    async function loop() {
      const delay = await analyzeFrame();
      if (!cancelled && delay) {
        timerId = window.setTimeout(loop, delay);
      }
    }

    setVision({ online: null, calibrating: true, result: null, attention: null, strikes: 0, error: "" });
    loop();

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [cameraReady, hasAcceptedCall, session?._id]);

  useEffect(() => {
    if (!hasAcceptedCall || !session?.endsAt || completionHandledRef.current) {
      return undefined;
    }

    if (new Date(session.endsAt).getTime() > now) {
      return undefined;
    }

    completionHandledRef.current = true;
    const message = "It's Time Up, upload your paper now.";

    setLastAlert(message);
    setStatus("Test finished. Upload your paper now.");

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
    }

    stopMediaStream();

    examApi
      .finishSession(session._id, { reason: "time-up" })
      .then((data) => {
        trackStudyEvent({ feature: "proctor", label: `Completed proctored test: ${session.title || "Mock test"}` });
        setSession(data.session || null);
        navigate("/app/evaluator");
      })
      .catch(() => {});
  }, [hasAcceptedCall, navigate, now, session]);

  useEffect(() => {
    if (!hasAcceptedCall || !session?._id || !session?.endsAt || fiveMinuteWarningRef.current === session._id) {
      return;
    }

    const remainingMs = new Date(session.endsAt).getTime() - now;

    if (remainingMs > 5 * 60 * 1000 || remainingMs <= 4 * 60 * 1000) {
      return;
    }

    fiveMinuteWarningRef.current = session._id;
    const message = "Only 5 minutes remaining, hurry up.";
    setLastAlert(message);

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onstart = () => {
        speakingRef.current = true;
      };
      utterance.onend = () => {
        speakingRef.current = false;
      };
      utterance.onerror = () => {
        speakingRef.current = false;
      };
      window.speechSynthesis.speak(utterance);
    }
  }, [hasAcceptedCall, now, session?._id, session?.endsAt]);

  async function leaveTest() {
    if (!session?._id) {
      navigate("/app/tests");
      return;
    }

    setLeaving(true);

    try {
      const data = await examApi.leaveSession(session._id);
      setSession(data.session || null);
      setStatus("You left the test. Upload your paper now.");
      setLastAlert("You left the test. Upload your paper now.");
      stopMediaStream();
      navigate("/app/evaluator");
    } catch (_error) {
      setStatus("Could not leave the test cleanly. Please try again.");
    } finally {
      setLeaving(false);
    }
  }

  const remainingTime = session?.endsAt ? Math.max(0, new Date(session.endsAt).getTime() - now) : null;
  const visionBadge =
    vision.online === false
      ? { tone: "offline", label: "Offline" }
      : vision.online === null
        ? { tone: "calibrating", label: "Starting..." }
        : vision.calibrating
          ? { tone: "calibrating", label: "Calibrating" }
          : vision.result?.status === "violation"
            ? { tone: "violation", label: "Violation" }
            : vision.result?.status === "warning"
              ? { tone: "warning", label: "Warning" }
              : { tone: "focused", label: "Focused" };

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1>Live AI Proctor Call</h1>
          <p>At the scheduled time Lakshya opens your monitored test automatically, keeps the camera on, and tracks focus while you write.</p>
        </div>
      </div>

      {!hasAcceptedCall ? (
        <section className="panel incoming-call-panel">
          <div className="panel-title">
            <BellRing size={18} />
            <h2>No Active Proctor Session</h2>
          </div>
          <p>
            {session?.status === "scheduled" && session?.startAt
              ? `Your next test is scheduled for ${formatStartTime(session.startAt)}. Lakshya will call you with a ringtone at that time. Accept the call to start.`
              : "Create and schedule a test in Practice Tests first. At the test time Lakshya calls you; accept the call to open AI Proctor."}
          </p>
          <div className="button-row">
            <button className="primary-button compact" type="button" onClick={() => navigate("/app/tests")}>
              Open Practice Tests
            </button>
            <span className="subtle">
              {session?.startAt ? `Next scheduled test: ${formatStartTime(session.startAt)}` : "No active schedule yet."}
            </span>
          </div>
        </section>
      ) : (
        <section className="proctor-exam-shell">
          <div className="proctor-exam-layout">
            <article className="panel proctor-paper-panel">
              <div className="proctor-paper-header">
                <div className="call-badge">AI Call Connected</div>
                <h2>{session.title}</h2>
                <p>{`${session.marks || 80} marks | ${session.durationMinutes || 60} minutes | Accepted ${formatStartTime(session.callAcceptedAt || session.startAt)}`}</p>
              </div>
              {session.generatedPaper?.questions?.length ? (
                <div className="proctor-paper-content">
                  <ExamPaper paper={session.generatedPaper} />
                </div>
              ) : session.generatedTest ? (
                <div className="explainer-markdown practice-markdown practice-paper-preview proctor-paper-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{session.generatedTest}</ReactMarkdown>
                </div>
              ) : (
                <div className="explainer-markdown practice-markdown practice-paper-preview proctor-paper-content">
                  <p className="muted-copy">The accepted test paper will appear here once it is ready.</p>
                </div>
              )}
            </article>

            <aside className="proctor-monitor-column">
              <section className="panel proctor-action-panel">
                <div className="proctor-time-chip">
                  <strong>Time Left</strong>
                  <span>{remainingTime === null ? "Waiting to start" : formatRemainingTime(remainingTime)}</span>
                </div>
                <button className="secondary-button compact" type="button" onClick={leaveTest} disabled={leaving}>
                  {leaving ? "Leaving..." : "Leave Test"}
                </button>
              </section>

              {joinedParticipants.length ? (
                <section className="panel proctor-participants-panel">
                  <div className="panel-title">
                    <Users size={18} />
                    <h2>Joined Students</h2>
                  </div>
                  <div className="proctor-participant-list">
                    {joinedParticipants.map((participant) => (
                      <div className="proctor-participant-card" key={`${participant.email || participant.name}-${participant.joinedAt || ""}`}>
                        <div>
                          <strong>{participant.name || participant.email || "Student"}</strong>
                          <p>{participant.email || "Room participant"}</p>
                        </div>
                        <span>{participant.isHost ? "Host" : formatJoinedTime(participant.joinedAt)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="proctor-stage proctor-stage-compact">
                <div className="camera-frame live proctor-floating-camera">
                  <video ref={videoRef} autoPlay muted playsInline className="proctor-video" />
                  <canvas ref={overlayRef} className="proctor-vision-overlay" aria-hidden="true" />
                  <canvas ref={canvasRef} hidden />
                  <div className="camera-overlay live">
                    <div className="warning-box">
                      <ScanFace size={18} />
                      {faceState}
                    </div>
                  </div>
                </div>
                <div className="proctor-controls">
                  <button className="primary-button compact" type="button" onClick={() => setMediaRequestKey((current) => current + 1)}>
                    <Video size={16} />
                    {cameraReady ? "Camera Active" : "Retry Camera"}
                  </button>
                  <button className="secondary-button compact" type="button">
                    <Mic size={16} />
                    {micReady ? "Mic Monitoring" : "Mic Pending"}
                  </button>
                </div>
                <div className="proctor-vision-panel">
                  <div className="proctor-vision-head">
                    <span className="panel-title">
                      <ScanEye size={18} />
                      <strong>AI Vision</strong>
                    </span>
                    <span className={`proctor-vision-badge is-${visionBadge.tone}`}>{visionBadge.label}</span>
                  </div>
                  <dl className="proctor-vision-stats">
                    <div>
                      <dt>Looking at</dt>
                      <dd>{vision.result ? GAZE_LABELS[vision.result.gaze] || vision.result.gaze : "--"}</dd>
                    </div>
                    <div>
                      <dt>People</dt>
                      <dd>{vision.result ? Math.max(vision.result.people, vision.result.faces) : "--"}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd className={vision.result?.phone ? "is-alert" : ""}>{vision.result ? (vision.result.phone ? "Detected" : "None") : "--"}</dd>
                    </div>
                    <div>
                      <dt>Book / notes</dt>
                      <dd>{vision.result ? (vision.result.book ? "On desk" : "None") : "--"}</dd>
                    </div>
                    <div>
                      <dt>Warnings</dt>
                      <dd className={vision.strikes ? "is-alert" : ""}>{vision.strikes}</dd>
                    </div>
                    <div>
                      <dt>Attention</dt>
                      <dd>{vision.attention === null ? "--" : `${vision.attention}%`}</dd>
                    </div>
                  </dl>
                  <p className="proctor-vision-note">
                    {vision.online === false
                      ? vision.error || "Vision service unavailable."
                      : "Frames are checked live with OpenCV + YOLO and never stored."}
                  </p>
                </div>
                <div className="assistant-tip">
                  <div className="panel-title">
                    <Camera size={18} />
                    <h2>Camera view</h2>
                  </div>
                  <p>{lastAlert || status || "Keep your face visible in the top-right camera window while reading and writing the paper."}</p>
                </div>
              </section>
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}

export default ProctorPage;
