import {
  BookOpen,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  Clock3,
  FileStack,
  Flame,
  LoaderCircle,
  ListChecks,
  Mic,
  RotateCw,
  Send,
  Sparkles,
  Target,
  Trash2,
  TriangleAlert,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { studyPlannerApi, trackStudyEvent } from "../api/client";

const SETTINGS_STORAGE_KEY = "lakshya_planner_settings";
const LOADING_STEPS = ["Understanding your request", "Retrieving syllabus units", "Ranking topics by past papers", "Building your timetable"];

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readSettings() {
  const defaults = { startDate: localDate(), dailyStart: "08:00", dailyEnd: "20:00", breakMinutes: 10, sessionMinutes: 50 };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    return { ...defaults, ...saved, startDate: saved.startDate && saved.startDate >= localDate() ? saved.startDate : defaults.startDate };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings simply won't persist in this browser.
  }
}

function formatClock(value = "") {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours)) {
    return value;
  }
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes || 0).padStart(2, "0")} ${suffix}`;
}

function formatMinutes(total = 0) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) {
    return `${minutes} min`;
  }
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function speakReminder(item) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(`Time for ${item.subject}, ${item.unit}. Today's topics: ${item.topics.join(", ")}.`);
  utterance.rate = 0.98;
  window.speechSynthesis.speak(utterance);
}

function buildSuggestions(syllabi) {
  const ready = syllabi.filter((syllabus) => syllabus.status === "ready");
  const subjects = ready.flatMap((syllabus) => syllabus.subjects.filter((subject) => subject.kind === "theory"));
  const semesters = [...new Set(ready.flatMap((syllabus) => syllabus.semesters))].sort((left, right) => right - left);
  const examDate = new Date();
  examDate.setDate(examDate.getDate() + 10);
  const examLabel = examDate.toLocaleDateString("en-IN", { day: "numeric", month: "long" });

  return [
    semesters[0] ? `Make a study plan for Semester ${semesters[0]}` : "Make a study plan for all my subjects",
    subjects[0] ? `Make a study plan for ${subjects[0].name} only` : null,
    "Only 5 days remaining, how can I complete all subjects?",
    `My exam is on ${examLabel}, I can study 4 hours a day`
  ].filter(Boolean);
}

function SyllabusCard({ syllabus, included, onToggle, onDelete, onRetry }) {
  const [open, setOpen] = useState(false);
  const theory = syllabus.subjects.filter((subject) => subject.kind === "theory");
  const progress = syllabus.progress?.total ? Math.round((syllabus.progress.done / syllabus.progress.total) * 100) : 5;

  return (
    <article className={`rag-file-card ${syllabus.status}`}>
      <div className="rag-file-head">
        {syllabus.status === "ready" ? (
          <input type="checkbox" checked={included} onChange={onToggle} aria-label={`Use ${syllabus.fileName} for planning`} />
        ) : null}
        <div className="rag-file-name">
          <strong title={syllabus.fileName}>{syllabus.fileName}</strong>
          {syllabus.status === "processing" ? (
            <span>
              Indexing subjects… {syllabus.progress?.done || 0}/{syllabus.progress?.total || "?"}
            </span>
          ) : syllabus.status === "failed" ? (
            <span className="rag-error-text">{syllabus.error || "Could not index this file."}</span>
          ) : (
            <span>
              {syllabus.semesters.length ? `Sem ${syllabus.semesters.join(", ")} · ` : ""}
              {theory.length} subjects
            </span>
          )}
        </div>
        <button className="rag-icon-button" type="button" onClick={onDelete} aria-label={`Delete ${syllabus.fileName}`}>
          <Trash2 size={16} />
        </button>
      </div>

      {syllabus.status === "processing" ? (
        <div className="rag-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {syllabus.status === "failed" ? (
        <button className="rag-link-button" type="button" onClick={onRetry}>
          <RotateCw size={14} /> Retry indexing
        </button>
      ) : null}

      {syllabus.status === "ready" && syllabus.extractionMode === "mixed" ? (
        <p className="rag-file-note">
          Some subjects were read without AI because the AI limit was reached. Their topic names may be rough.{" "}
          <button className="rag-link-button rag-inline" type="button" onClick={onRetry}>
            Retry later
          </button>
        </p>
      ) : null}

      {syllabus.status === "ready" && theory.length ? (
        <>
          <button className="rag-link-button" type="button" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide subjects" : "Show subjects"}
            <ChevronDown size={14} className={open ? "rag-rotate" : ""} />
          </button>
          {open ? (
            <ul className="rag-subject-list">
              {theory.map((subject) => (
                <li key={subject.key}>
                  <span>{subject.code || "—"}</span>
                  <div>
                    <strong>{subject.name}</strong>
                    <small>
                      {subject.unitCount} units · {subject.topicCount} topics
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function TimelineItem({ item }) {
  if (item.type === "break" || item.type === "lunch") {
    return (
      <div className={`rag-break-row ${item.type}`}>
        <span>{formatClock(item.start)}</span>
        <p>
          {item.title} · {item.minutes} min
        </p>
      </div>
    );
  }

  return (
    <article className={`rag-session ${item.type}`}>
      <div className="rag-session-time">
        <strong>{formatClock(item.start)}</strong>
        <span>{formatClock(item.end)}</span>
      </div>
      <div className="rag-session-body">
        <div className="rag-session-meta">
          {item.code ? <span className="rag-code">{item.code}</span> : null}
          <span className={`tag ${item.priority}`}>{item.priority}</span>
          <span className="rag-mode">{item.mode}</span>
          {item.pyqQuestions ? <span className="rag-pyq">Asked {item.pyqQuestions}×</span> : null}
        </div>
        <h4>
          {item.type === "revision" ? "Revise · " : ""}
          {item.subject}
        </h4>
        <p className="rag-session-unit">
          Unit {item.unitNumber}: {item.unit}
        </p>
        <p className="rag-session-topics">{item.topics.join(" · ")}</p>
      </div>
      <button className="rag-icon-button" type="button" onClick={() => speakReminder(item)} aria-label="Play voice reminder">
        <Mic size={16} />
      </button>
    </article>
  );
}

function PriorityRow({ entry, rank }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="rag-priority-row">
      <button className="rag-priority-head" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="rag-rank">{rank}</span>
        <div className="rag-priority-title">
          <strong>{entry.unit}</strong>
          <span>
            {entry.code || entry.subject} · Unit {entry.unitNumber}
            {entry.hours ? ` · ${entry.hours} lecture hrs` : ""}
          </span>
          <div className="rag-score-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(entry.score * 100)}%` }} />
          </div>
        </div>
        <div className="rag-priority-side">
          <span className={`tag ${entry.priority}`}>{entry.priority}</span>
          <small>{entry.pyqQuestions ? `Asked ${entry.pyqQuestions}×` : entry.focused ? "Your focus" : "No PYQ data"}</small>
          <small>{formatMinutes(entry.minutes)}</small>
        </div>
        <ChevronDown size={16} className={open ? "rag-rotate" : ""} />
      </button>
      {open ? (
        <div className="rag-priority-detail">
          <ul>
            {entry.topics.map((topic) => (
              <li key={topic.name}>
                <span>{topic.name}</span>
                <small>
                  {topic.minutes ? `${formatMinutes(topic.minutes)} · ${topic.mode}` : topic.mode}
                  {topic.pyqQuestions ? ` · asked ${topic.pyqQuestions}×` : ""}
                </small>
              </li>
            ))}
          </ul>
          {entry.samples?.length ? (
            <div className="rag-evidence">
              <span>From past papers</span>
              {entry.samples.map((sample) => (
                <q key={sample}>{sample}</q>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ElectiveChoice({ choice, onSubmit }) {
  const [selected, setSelected] = useState({});
  const complete = choice.groups.every((group) => selected[group.key]);

  function pick(group, option) {
    const next = { ...selected, [group.key]: option.key };
    setSelected(next);
    // With a single group there is nothing else to choose, so build the plan straight away.
    if (choice.groups.length === 1) {
      onSubmit(next);
    }
  }

  return (
    <section className="planner-result-card rag-choice">
      <div className="panel-title">
        <ListChecks size={18} />
        <h3>Choose your optional course</h3>
      </div>
      <p>{choice.question}</p>
      {choice.groups.map((group) => (
        <div key={group.key} className="rag-choice-group" role="radiogroup" aria-label={group.label}>
          {choice.groups.length > 1 ? <strong>{group.label}</strong> : null}
          <div className="rag-choice-options">
            {group.options.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={selected[group.key] === option.key}
                className={`rag-choice-option${selected[group.key] === option.key ? " selected" : ""}`}
                onClick={() => pick(group, option)}
              >
                {option.code ? <span className="rag-code">{option.code}</span> : null}
                <strong>{option.name}</strong>
              </button>
            ))}
          </div>
        </div>
      ))}
      {choice.groups.length > 1 ? (
        <button className="primary-button compact rag-choice-submit" type="button" disabled={!complete} onClick={() => onSubmit(selected)}>
          Build my plan
        </button>
      ) : null}
      <p className="planner-simple-note">Lakshya remembers your choice for this syllabus. You can change it later from the plan.</p>
    </section>
  );
}

function PlanView({ plan, onChangeElectives }) {
  const today = localDate();
  const todayIndex = plan.days.findIndex((day) => day.date === today);
  const [activeDay, setActiveDay] = useState(Math.max(0, todayIndex));
  const day = plan.days[activeDay] || plan.days[0];
  const totalStudy = plan.days.reduce((sum, entry) => sum + entry.studyMinutes, 0);

  return (
    <div className="rag-plan">
      <section className="planner-result-card rag-summary-card">
        <div className="rag-summary-top">
          <div>
            <span className="rag-kicker">{plan.stats.crunch ? "Crash plan" : "Full syllabus plan"}</span>
            <h3>{plan.scope.label}</h3>
            <p>{plan.strategy.headline}</p>
            {plan.electives?.length ? (
              <p className="rag-elective-line">
                Elective: {plan.electives.map((choice) => choice.subject.name).join(", ")} ·{" "}
                <button className="rag-link-button rag-inline" type="button" onClick={() => onChangeElectives(plan)}>
                  Change
                </button>
              </p>
            ) : null}
          </div>
          {plan.stats.crunch ? (
            <span className="rag-badge crunch">
              <Flame size={16} /> Priority mode
            </span>
          ) : (
            <span className="rag-badge">
              <CircleCheck size={16} /> Full coverage
            </span>
          )}
        </div>
        <div className="rag-stats">
          <div>
            <strong>{plan.days.length}</strong>
            <span>days</span>
          </div>
          <div>
            <strong>{formatMinutes(totalStudy)}</strong>
            <span>study time</span>
          </div>
          <div>
            <strong>{plan.stats.coverage}%</strong>
            <span>syllabus time covered</span>
          </div>
          <div>
            <strong>
              {plan.stats.topicsCovered}/{plan.stats.topicsTotal}
            </strong>
            <span>topics planned</span>
          </div>
          <div>
            <strong>{plan.stats.paperCount}</strong>
            <span>past papers analysed</span>
          </div>
        </div>
        {plan.warnings?.length ? (
          <div className="rag-warnings">
            {plan.warnings.map((warning) => (
              <p key={warning}>
                <TriangleAlert size={15} /> {warning}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="planner-result-card">
        <div className="panel-title">
          <Sparkles size={18} />
          <h3>How to approach it</h3>
        </div>
        <ul className="rag-strategy">
          {plan.strategy.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        {plan.strategy.subjectTips?.length ? (
          <div className="rag-tips">
            {plan.strategy.subjectTips.map((tip) => (
              <div key={tip.subject}>
                <strong>{tip.subject}</strong>
                <p>{tip.tip}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="planner-result-card">
        <div className="panel-title">
          <CalendarClock size={18} />
          <h3>Timetable</h3>
        </div>
        <div className="rag-day-tabs" role="tablist" aria-label="Plan days">
          {plan.days.map((entry, index) => (
            <button
              key={entry.date}
              type="button"
              role="tab"
              aria-selected={index === activeDay}
              className={`rag-day-tab${index === activeDay ? " active" : ""}`}
              onClick={() => setActiveDay(index)}
            >
              <strong>Day {index + 1}</strong>
              <span>{entry.date === today ? "Today" : entry.label.split("·")[1]?.trim()}</span>
            </button>
          ))}
        </div>
        {day ? (
          <div className="rag-day">
            <p className="rag-day-caption">
              <Clock3 size={15} /> {day.label} · {formatMinutes(day.studyMinutes)} of study
            </p>
            {day.items.length ? (
              day.items.map((item, index) => <TimelineItem key={`${day.date}-${index}`} item={item} />)
            ) : (
              <p className="planner-simple-note">Nothing scheduled on this day.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="planner-result-card">
        <div className="panel-title">
          <Target size={18} />
          <h3>Priority order</h3>
        </div>
        <p>
          Units ranked by {plan.stats.paperCount ? "how often they appear in your past papers, " : ""}lecture hours and weightage. Tap a unit to see topic
          timings.
        </p>
        <div className="rag-priority-list">
          {plan.priorities.map((entry, index) => (
            <PriorityRow key={`${entry.code}-${entry.unitNumber}-${entry.subject}`} entry={entry} rank={index + 1} />
          ))}
        </div>
        {plan.skipped?.length ? (
          <details className="rag-skipped">
            <summary>{plan.skipped.length} low-priority topics deferred (study only if time permits)</summary>
            <ul>
              {plan.skipped.map((topic) => (
                <li key={`${topic.subject}-${topic.unit}-${topic.topic}`}>
                  {topic.topic} <small>· {topic.subject}</small>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {plan.sources?.length ? (
        <p className="rag-sources">
          <BookOpen size={14} /> Grounded in: {plan.sources.map((source) => source.label).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function PlannerPage() {
  const [library, setLibrary] = useState({ syllabi: [], papers: [] });
  const [excludedIds, setExcludedIds] = useState([]);
  const [plan, setPlan] = useState(null);
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState(readSettings);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [uploading, setUploading] = useState("");
  const [choice, setChoice] = useState(null);
  const syllabusInput = useRef(null);
  const paperInput = useRef(null);

  const readySyllabi = library.syllabi.filter((syllabus) => syllabus.status === "ready");
  const processing = library.syllabi.some((syllabus) => syllabus.status === "processing");
  const suggestions = useMemo(() => buildSuggestions(library.syllabi), [library.syllabi]);

  const loadLibrary = useCallback(async () => {
    try {
      const data = await studyPlannerApi.library();
      setLibrary({ syllabi: data.syllabi || [], papers: data.papers || [] });
    } catch (error) {
      setStatus({ type: "error", text: error.message || "Could not load your syllabus library." });
    }
  }, []);

  useEffect(() => {
    loadLibrary();
    studyPlannerApi
      .latestPlan()
      .then((data) => setPlan(data.plan || null))
      .catch(() => setPlan(null));
  }, [loadLibrary]);

  useEffect(() => {
    if (!processing) {
      return undefined;
    }
    const timer = setTimeout(loadLibrary, 3000);
    return () => clearTimeout(timer);
  }, [processing, library, loadLibrary]);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }
    setLoadingStep(0);
    const timer = setInterval(() => setLoadingStep((step) => Math.min(step + 1, LOADING_STEPS.length - 1)), 900);
    return () => clearInterval(timer);
  }, [loading]);

  function updateSetting(event) {
    const { name, value } = event.target;
    setSettings((current) => {
      const next = { ...current, [name]: name === "breakMinutes" || name === "sessionMinutes" ? Number(value) : value };
      saveSettings(next);
      return next;
    });
  }

  async function onSyllabusUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setUploading("syllabus");
    setStatus(null);
    try {
      await studyPlannerApi.uploadSyllabus(file);
      setStatus({ type: "info", text: `${file.name} uploaded. Lakshya is indexing its subjects, units and topics…` });
      await loadLibrary();
    } catch (error) {
      setStatus({ type: "error", text: error.message });
    } finally {
      setUploading("");
    }
  }

  async function onPaperUpload(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) {
      return;
    }
    setUploading("papers");
    setStatus(null);
    try {
      const data = await studyPlannerApi.uploadPapers(files);
      setStatus({
        type: data.message ? "error" : "info",
        text: data.message || `${data.papers.length} past paper${data.papers.length === 1 ? "" : "s"} added. Your next plan will rank topics by how often they were asked.`
      });
      await loadLibrary();
    } catch (error) {
      setStatus({ type: "error", text: error.message });
    } finally {
      setUploading("");
    }
  }

  async function deleteSyllabus(syllabus) {
    if (!window.confirm(`Delete ${syllabus.fileName} from your syllabus library?`)) {
      return;
    }
    try {
      await studyPlannerApi.deleteSyllabus(syllabus._id);
      await loadLibrary();
    } catch (error) {
      setStatus({ type: "error", text: error.message });
    }
  }

  async function retrySyllabus(syllabus) {
    try {
      await studyPlannerApi.retrySyllabus(syllabus._id);
      setStatus({ type: "info", text: `Re-indexing ${syllabus.fileName}. Subjects that already finished are reused, so this is quicker.` });
      await loadLibrary();
    } catch (error) {
      setStatus({ type: "error", text: error.message });
    }
  }

  async function deletePaper(paper) {
    try {
      await studyPlannerApi.deletePaper(paper._id);
      await loadLibrary();
    } catch (error) {
      setStatus({ type: "error", text: error.message });
    }
  }

  async function generatePlan(text = message, electiveChoices = undefined) {
    const request = text.trim();
    if (!request || loading) {
      return;
    }
    if (!readySyllabi.length) {
      setStatus({ type: "error", text: processing ? "Your syllabus is still being indexed. Try again in a moment." : "Upload your syllabus PDF first." });
      return;
    }

    setLoading(true);
    setStatus(null);
    setMessage(request);
    try {
      const now = new Date();
      const data = await studyPlannerApi.generatePlan({
        message: request,
        syllabusIds: readySyllabi.filter((syllabus) => !excludedIds.includes(syllabus._id)).map((syllabus) => syllabus._id),
        electiveChoices,
        preferences: {
          ...settings,
          clientToday: localDate(),
          nowMinutes: now.getHours() * 60 + now.getMinutes()
        }
      });
      if (data.needsChoice) {
        setChoice({ ...data.needsChoice, request });
      } else {
        setChoice(null);
        setPlan(data.plan);
        trackStudyEvent({ feature: "planner", label: `Built a study plan: ${request}` });
      }
      setMessage("");
    } catch (error) {
      setStatus({ type: "error", text: error.message || "Could not build the plan." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen chat-screen">
      <div className="screen-header compact-header">
        <div>
          <h1>AI Study Planner</h1>
          <p>Upload your syllabus and past papers, then ask for a plan. Lakshya schedules every topic by priority, with exact timings.</p>
        </div>
      </div>

      <section className="planner-simple-body">
        <div className="planner-simple-grid">
          <aside className="planner-simple-sidebar rag-sidebar">
            <section className="planner-simple-card">
              <div className="rag-card-head">
                <h3>Syllabus</h3>
                <button className="secondary-button compact" type="button" onClick={() => syllabusInput.current?.click()} disabled={Boolean(uploading)}>
                  {uploading === "syllabus" ? <LoaderCircle size={16} className="rag-spin" /> : <Upload size={16} />}
                  Upload PDF
                </button>
                <input ref={syllabusInput} type="file" accept="application/pdf,.pdf,.txt" onChange={onSyllabusUpload} hidden />
              </div>
              {library.syllabi.length ? (
                library.syllabi.map((syllabus) => (
                  <SyllabusCard
                    key={syllabus._id}
                    syllabus={syllabus}
                    included={!excludedIds.includes(syllabus._id)}
                    onToggle={() =>
                      setExcludedIds((current) =>
                        current.includes(syllabus._id) ? current.filter((id) => id !== syllabus._id) : [...current, syllabus._id]
                      )
                    }
                    onDelete={() => deleteSyllabus(syllabus)}
                    onRetry={() => retrySyllabus(syllabus)}
                  />
                ))
              ) : (
                <p className="planner-simple-note">Upload your university syllabus PDF (with module/unit contents). Lakshya indexes every subject, unit and topic.</p>
              )}
            </section>

            <section className="planner-simple-card">
              <div className="rag-card-head">
                <h3>Past papers</h3>
                <button className="secondary-button compact" type="button" onClick={() => paperInput.current?.click()} disabled={Boolean(uploading)}>
                  {uploading === "papers" ? <LoaderCircle size={16} className="rag-spin" /> : <FileStack size={16} />}
                  Add
                </button>
                <input ref={paperInput} type="file" accept="application/pdf,.pdf,.txt" multiple onChange={onPaperUpload} hidden />
              </div>
              <p className="planner-simple-note">Previous-year question papers tell Lakshya which topics are asked most often.</p>
              {library.papers.length ? (
                <ul className="rag-paper-list">
                  {library.papers.map((paper) => (
                    <li key={paper._id}>
                      <FileStack size={15} />
                      <span title={paper.fileName}>{paper.fileName}</span>
                      <button className="rag-icon-button" type="button" onClick={() => deletePaper(paper)} aria-label={`Remove ${paper.fileName}`}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="planner-simple-card">
              <h3>Study timings</h3>
              <div className="planner-simple-form">
                <label>
                  <span>Start date</span>
                  <input type="date" name="startDate" min={localDate()} value={settings.startDate} onChange={updateSetting} />
                </label>
                <label>
                  <span>Session</span>
                  <select name="sessionMinutes" value={settings.sessionMinutes} onChange={updateSetting}>
                    {[30, 40, 50, 60, 75, 90].map((value) => (
                      <option key={value} value={value}>
                        {value} min
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Day starts</span>
                  <input type="time" name="dailyStart" value={settings.dailyStart} onChange={updateSetting} />
                </label>
                <label>
                  <span>Day ends</span>
                  <input type="time" name="dailyEnd" value={settings.dailyEnd} onChange={updateSetting} />
                </label>
                <label>
                  <span>Break</span>
                  <select name="breakMinutes" value={settings.breakMinutes} onChange={updateSetting}>
                    {[0, 5, 10, 15, 20].map((value) => (
                      <option key={value} value={value}>
                        {value} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="planner-simple-note">Say "4 hours a day" in your request to override the day window.</p>
            </section>
          </aside>

          <div className="planner-simple-main">
            {status ? <div className={`planner-status explainer-status rag-status ${status.type}`}>{status.text}</div> : null}

            {loading ? (
              <div className="rag-loading">
                <LoaderCircle size={30} className="rag-spin" />
                <ol>
                  {LOADING_STEPS.map((step, index) => (
                    <li key={step} className={index < loadingStep ? "done" : index === loadingStep ? "active" : ""}>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            ) : choice ? (
              <ElectiveChoice key={choice.request} choice={choice} onSubmit={(picked) => generatePlan(choice.request, picked)} />
            ) : plan ? (
              <PlanView
                key={plan._id}
                plan={plan}
                onChangeElectives={(current) =>
                  generatePlan(current.request, Object.fromEntries(current.electives.map((elective) => [elective.group, null])))
                }
              />
            ) : (
              <div className="ask-center planner-empty-state">
                <div className="upload-icon">
                  <Sparkles size={38} />
                </div>
                <h2>Build your study plan</h2>
                <p>
                  {readySyllabi.length
                    ? "Ask for a whole semester, a single subject, or a crash plan for the days you have left."
                    : "Start by uploading your syllabus PDF on the left. Add past papers to rank topics by how often they are asked."}
                </p>
              </div>
            )}

            {!loading && readySyllabi.length ? (
              <div className="chip-row rag-suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} className="chip" type="button" onClick={() => generatePlan(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <form
          className="planner-action-row rag-action-row"
          onSubmit={(event) => {
            event.preventDefault();
            generatePlan();
          }}
        >
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            type="text"
            placeholder='e.g. "Make a study plan for Semester 6" or "Only 5 days left for DBMS"'
            aria-label="Describe the study plan you need"
          />
          <button className="send-button" type="submit" disabled={loading || !message.trim()} aria-label="Generate plan">
            {loading ? <LoaderCircle size={18} className="rag-spin" /> : <Send size={18} />}
          </button>
        </form>
      </section>
    </div>
  );
}

export default PlannerPage;
