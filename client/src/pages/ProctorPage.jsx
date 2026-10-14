import { BellRing, Camera, Mic, ScanFace, Users, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate } from "react-router-dom";
import { examApi, trackStudyEvent } from "../api/client";
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
  const streamRef = useRef(null);
  const speakingRef = useRef(false);
  const analysisIntervalRef = useRef(null);
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
  const hasAcceptedCall = session?.status === "active" && Boolean(session?.callAcceptedAt);
  const joinedParticipants = session?.sharedParticipants || [];
  const learnerName = String(user?.name || "").trim().split(/\s+/)[0] || "there";

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
          .then((data) => setSession(data.session || session))
          .catch(() => {});
      }
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
  }, [hasAcceptedCall, session]);

  useEffect(() => {
    if (!hasAcceptedCall || !cameraReady || !videoRef.current) {
      return undefined;
    }

    let cancelled = false;

    async function analyzeFrame() {
      if (cancelled || !videoRef.current || !canvasRef.current) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return;
      }

      if ("FaceDetector" in window) {
        try {
          const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
          const faces = await detector.detect(video);

          if (!faces.length) {
            setFaceState("Face not detected clearly. Keep your head and desk in frame.");
            setLastAlert("Camera lost a stable face lock.");
            return;
          }

          const face = faces[0].boundingBox;
          const verticalCenter = face.y + face.height / 2;
          const ratio = verticalCenter / video.videoHeight;

          if (ratio < 0.25) {
            const message = pickAlert(warningCountRef.current);
            setFaceState("You seem to be looking away from the paper.");
            setLastAlert(message);
            warningCountRef.current += 1;
            if (session?._id) {
              examApi.proctorAlert(session._id, { message, attentionScore: 76 }).catch(() => {});
            }
            if ("speechSynthesis" in window && !speakingRef.current) {
              const utterance = new SpeechSynthesisUtterance(message);
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
          } else {
            setFaceState("Posture looks steady for writing.");
          }
          return;
        } catch (_error) {
          setFaceState("Camera monitoring is active. Browser face detection is limited here.");
        }
      }

      const context = canvas.getContext("2d");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setFaceState("Camera monitoring is active. Tab switch and focus protection are enabled.");
    }

    analysisIntervalRef.current = window.setInterval(() => {
      analyzeFrame();
    }, 6000);

    return () => {
      cancelled = true;
      if (analysisIntervalRef.current) {
        window.clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
      }
    };
  }, [cameraReady, hasAcceptedCall, session]);

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
              ? `Your next test is scheduled for ${formatStartTime(session.startAt)}. Lakshya will move you here automatically at that time.`
              : "Create and schedule a test in Practice Tests first. Lakshya will open AI Proctor automatically when the test time arrives."}
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
              {session.generatedTest ? (
                <div className="explainer-markdown practice-markdown practice-paper-preview proctor-paper-content">
                  <ReactMarkdown>{session.generatedTest}</ReactMarkdown>
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
