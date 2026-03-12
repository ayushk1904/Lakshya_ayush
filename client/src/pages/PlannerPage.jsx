import { Bell, Clock3, Mic, Sparkles, Upload } from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { studyPlanApi } from "../api/client";

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getLocalTime(hour, minute = 0) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildFallbackPlan() {
  const today = getTodayDate();
  return {
    studyDate: today,
    syllabusName: "Study Plan.pdf",
    studyWindow: {
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 15,
      reminderLeadMinutes: 5,
    },
    summary: {
      totalSessions: 2,
      totalMinutes: 150,
      focusMessage:
        "Start with your first topic and focus deeply for this session.",
    },
    sessions: [
      {
        id: "fallback-1",
        subject: "Subject 1",
        chapter: "Chapter 1",
        topic: "Topic 1",
        durationMinutes: 90,
        priority: "high",
        startAt: `${today}T09:00:00.000Z`,
        endAt: `${today}T10:30:00.000Z`,
        reminderAt: `${today}T08:55:00.000Z`,
        reminderLeadMinutes: 5,
        time: "9:00 AM - 10:30 AM",
        task: "Subject 1 - Chapter 1: Topic 1",
        tag: "high",
        reminderText:
          "Start with Subject 1, Chapter 1. Focus fully for this session.",
      },
      {
        id: "fallback-2",
        subject: "Subject 2",
        chapter: "Chapter 1",
        topic: "Topic 2",
        durationMinutes: 60,
        priority: "medium",
        startAt: `${today}T11:00:00.000Z`,
        endAt: `${today}T12:00:00.000Z`,
        reminderAt: `${today}T10:55:00.000Z`,
        reminderLeadMinutes: 5,
        time: "11:00 AM - 12:00 PM",
        task: "Subject 2 - Chapter 1: Topic 2",
        tag: "medium",
        reminderText:
          "Now move to Subject 2, Topic 2. Stay focused for this block.",
      },
    ],
  };
}

function normalizePlan(data) {
  if (!data) {
    return buildFallbackPlan();
  }

  if (data.sessions?.length) {
    return data;
  }

  if (data.plan?.sessions?.length || data.plan?.todayPlan?.length) {
    return normalizePlan(data.plan);
  }

  if (data.todayPlan?.length) {
    return {
      ...buildFallbackPlan(),
      ...data,
      sessions: data.todayPlan.map((item, index) => ({
        id: `legacy-${index + 1}`,
        subject: item.task.split(" - ")[0] || "Study",
        chapter: "Focused Revision",
        topic: item.task,
        durationMinutes: 60,
        priority: item.tag || "medium",
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        reminderAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        reminderLeadMinutes: 5,
        time: item.time,
        task: item.task,
        tag: item.tag || "medium",
        reminderText: item.reminderText || `It is time to begin ${item.task}.`,
      })),
    };
  }

  return buildFallbackPlan();
}

function formatDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not scheduled";
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PlannerPage() {
  const [plan, setPlan] = useState(buildFallbackPlan());
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    syllabusName: "Study Plan.pdf",
    studyDate: getTodayDate(),
    startTime: getLocalTime(7, 0),
    endTime: getLocalTime(21, 0),
    breakMinutes: 15,
    reminderLeadMinutes: 5,
    topicsInput: [
      "Subject 1 | Chapter 1 | Topic 1 | 90 | high",
      "Subject 2 | Chapter 1 | Topic 2 | 60 | medium",
    ].join("\n"),
  });
  const [pdfFile, setPdfFile] = useState(null);
  const timersRef = useRef([]);

  useEffect(() => {
    let active = true;

    async function loadPlan() {
      try {
        const data = await studyPlanApi.today();
        if (!active) return;

        startTransition(() => {
          setPlan(normalizePlan(data));
        });
      } catch {
        if (active) {
          setPlan(buildFallbackPlan());
        }
      }
    }

    loadPlan();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    for (const timer of timersRef.current) {
      window.clearTimeout(timer);
    }
    timersRef.current = [];

    if (!voiceEnabled) {
      return undefined;
    }

    const now = Date.now();
    const todaysSessions = (plan.sessions || []).filter((session) => {
      const reminderTime = new Date(session.reminderAt).getTime();
      return reminderTime > now;
    });

    for (const session of todaysSessions) {
      const triggerIn = new Date(session.reminderAt).getTime() - now;
      const timer = window.setTimeout(() => {
        speakReminder(session.reminderText);

        if (
          notificationEnabled &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          new Notification("Lakshya study reminder", {
            body: session.reminderText,
          });
        }
      }, triggerIn);

      timersRef.current.push(timer);
    }

    return () => {
      for (const timer of timersRef.current) {
        window.clearTimeout(timer);
      }
      timersRef.current = [];
    };
  }, [notificationEnabled, plan.sessions, voiceEnabled]);

  const nextReminder = useMemo(() => {
    const now = Date.now();
    return (
      (plan.sessions || []).find(
        (session) => new Date(session.reminderAt).getTime() > now
      ) || null
    );
  }, [plan.sessions]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function onPdfChange(event) {
    const file = event.target.files?.[0] || null;
    setPdfFile(file);
    if (file) {
      // Update syllabusName to match uploaded PDF name
      setForm((current) => ({ ...current, syllabusName: file.name }));
    }
  }

  function speakReminder(text) {
    if (!("speechSynthesis" in window)) {
      setStatus("Voice reminders are not supported in this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    setStatus("Voice reminder played.");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setStatus("Browser notifications are not supported here.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotificationEnabled(true);
      setStatus("Browser notifications enabled for planner reminders.");
      return;
    }

    setNotificationEnabled(false);
    setStatus("Notification permission was not granted.");
  }

  async function generatePlan() {
    setLoading(true);
    setStatus("");

    try {
      // If your backend needs the actual file, you would use FormData here.
      // For now we send the PDF name as syllabusName (already set above).
      const data = await studyPlanApi.generate({
        syllabusName: form.syllabusName,
        studyDate: form.studyDate,
        startTime: form.startTime,
        endTime: form.endTime,
        breakMinutes: Number(form.breakMinutes),
        reminderLeadMinutes: Number(form.reminderLeadMinutes),
        topicsInput: form.topicsInput,
      });

      startTransition(() => {
        setPlan(normalizePlan(data.plan));
      });
      setStatus(
        "Study plan generated. Enable voice reminders to hear scheduled prompts."
      );
    } catch {
      setPlan(buildFallbackPlan());
      setStatus("Planner API unavailable. Showing a fallback plan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen planner-screen">
      <div className="screen-header">
        <div>
          <h1>AI Study Planner</h1>
          <p>
            Build a timed study schedule and get spoken reminders before each
            focus block starts.
          </p>
        </div>
      </div>

      <div className="planner-layout">
        <section className="panel planner-form-panel">
          <div className="panel-title">
            <h2>Plan Inputs</h2>
          </div>
          <div className="planner-grid">
            <label className="planner-field planner-field-wide">
              <span>Upload syllabus PDF</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={onPdfChange}
              />
            </label>

            <label className="planner-field planner-field-wide">
              <span>Syllabus or exam name</span>
              <input
                name="syllabusName"
                value={form.syllabusName}
                onChange={updateField}
                placeholder="My Exam Syllabus.pdf"
              />
            </label>

            <label className="planner-field">
              <span>Study date</span>
              <input
                name="studyDate"
                type="date"
                value={form.studyDate}
                onChange={updateField}
              />
            </label>

            <label className="planner-field">
              <span>Start time</span>
              <input
                name="startTime"
                type="time"
                value={form.startTime}
                onChange={updateField}
              />
            </label>

            <label className="planner-field">
              <span>End time</span>
              <input
                name="endTime"
                type="time"
                value={form.endTime}
                onChange={updateField}
              />
            </label>

            <label className="planner-field">
              <span>Break minutes</span>
              <input
                name="breakMinutes"
                type="number"
                min="0"
                max="60"
                value={form.breakMinutes}
                onChange={updateField}
              />
            </label>

            <label className="planner-field">
              <span>Reminder lead time</span>
              <input
                name="reminderLeadMinutes"
                type="number"
                min="0"
                max="30"
                value={form.reminderLeadMinutes}
                onChange={updateField}
              />
            </label>

            <label className="planner-field planner-field-wide">
              <span>Topics to schedule</span>
              <textarea
                name="topicsInput"
                value={form.topicsInput}
                onChange={updateField}
                rows={6}
                placeholder="Subject | Chapter | Topic | Minutes | Priority"
              />
            </label>
          </div>
          <p className="planner-note">
            Use one line per topic in this format:{" "}
            <strong>Subject | Chapter | Topic | Minutes | Priority</strong>.
          </p>
          <div className="planner-actions">
            <button
              className="primary-button"
              onClick={generatePlan}
              disabled={loading}
            >
              <Upload size={16} />
              {loading ? "Generating..." : "Generate Study Plan"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => speakReminder(plan.summary?.focusMessage || "")}
            >
              <Mic size={16} />
              Test Voice Prompt
            </button>
          </div>
          {status ? <div className="planner-status">{status}</div> : null}
        </section>

        <section className="panel planner-reminder-panel">
          <div className="panel-title">
            <h2>Reminder Controls</h2>
          </div>
          <div className="planner-reminder-stack">
            <div className="planner-reminder-card">
              <div className="planner-icon-badge">
                <Bell size={18} />
              </div>
              <div>
                <strong>Voice reminder</strong>
                <p>
                  Keep Lakshya open in your browser to hear spoken prompts
                  before each session.
                </p>
              </div>
              <label className="planner-toggle">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(event) => setVoiceEnabled(event.target.checked)}
                />
                <span>{voiceEnabled ? "On" : "Off"}</span>
              </label>
            </div>

            <div className="planner-reminder-card">
              <div className="planner-icon-badge">
                <Sparkles size={18} />
              </div>
              <div>
                <strong>Browser notification</strong>
                <p>
                  Optional desktop reminder in addition to voice for the same
                  study block.
                </p>
              </div>
              <button
                className="secondary-button compact"
                type="button"
                onClick={enableNotifications}
              >
                Allow Notifications
              </button>
            </div>

            <div className="planner-next-reminder">
              <div className="planner-next-label">Next reminder</div>
              {nextReminder ? (
                <>
                  <strong>{nextReminder.task}</strong>
                  <span>{formatDateTime(nextReminder.reminderAt)}</span>
                  <p>{nextReminder.reminderText}</p>
                </>
              ) : (
                <p>No future reminder scheduled yet. Generate a fresh plan for today.</p>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="planner-summary-grid">
        <article className="quick-card planner-summary-card">
          <Clock3 size={20} />
          <span>Total Sessions</span>
          <strong>{plan.summary?.totalSessions || plan.sessions?.length || 0}</strong>
        </article>
        <article className="quick-card planner-summary-card">
          <Bell size={20} />
          <span>Reminder Lead</span>
          <strong>{plan.studyWindow?.reminderLeadMinutes || 0} min</strong>
        </article>
        <article className="quick-card planner-summary-card">
          <Mic size={20} />
          <span>Focus Prompt</span>
          <strong>{plan.summary?.focusMessage ? "Ready" : "Pending"}</strong>
        </article>
      </div>

      <section className="panel">
        <div className="panel-title">
          <h2>Generated Timeline</h2>
        </div>
        <div className="planner-timeline">
          {(plan.sessions || []).map((session) => (
            <article
              className="planner-session-card"
              key={session.id || session.time}
            >
              <div className="planner-session-head">
                <div>
                  <div className="planner-session-time">{session.time}</div>
                  <h3>{session.subject}</h3>
                </div>
                <span className={`tag ${session.tag || session.priority}`}>
                  {session.tag || session.priority}
                </span>
              </div>
              <p className="planner-session-topic">
                {session.chapter} · {session.topic}
              </p>
              <div className="planner-session-meta">
                <span>{session.durationMinutes} min focus</span>
                <span>Reminder: {formatDateTime(session.reminderAt)}</span>
              </div>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => speakReminder(session.reminderText)}
              >
                <Mic size={16} />
                Play Reminder
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default PlannerPage;
