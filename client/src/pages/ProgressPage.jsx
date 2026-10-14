import { Award, CalendarCheck, Clock3, Flame, Target, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { progressApi } from "../api/client";

const FEATURE_LABELS = {
  planner: "Study Planner",
  explainer: "Concept Explainer",
  hub: "Study Hub",
  tests: "Practice Tests",
  proctor: "Live AI Proctor",
  evaluator: "Answer Evaluator",
  coach: "Last-Minute Coach"
};

const TARGETS = [40, 60, 75, 90];
const REFRESH_MS = 30 * 1000;
const MIN_SPREAD = 8;

function formatMinutes(minutes = 0) {
  const total = Math.round(minutes);

  if (total < 60) {
    return `${total}m`;
  }

  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function weekdayLabel(day) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
}

function shortDate(value) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function timeAgo(value) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return shortDate(value);
}

// Abramowitz-Stegun approximation; accurate to ~1e-7, plenty for a progress chart.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x, mean, sd) {
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

function normalPdf(x, mean, sd) {
  return Math.exp(-((x - mean) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));
}

// Fits a bell curve to past scores, clipped to the 0-100 range scores can take.
function buildScoreModel(scores) {
  if (scores.length < 2) {
    return null;
  }

  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (scores.length - 1);
  const sd = Math.max(Math.sqrt(variance), MIN_SPREAD);
  const inRange = normalCdf(100, mean, sd) - normalCdf(0, mean, sd);

  return {
    mean,
    sd,
    chanceAtLeast: (target) => Math.max(0, Math.min(1, (normalCdf(100, mean, sd) - normalCdf(target, mean, sd)) / inRange)),
    density: (x) => normalPdf(x, mean, sd) / inRange
  };
}

function buildAchievements(summary) {
  const scores = summary.scores.map((entry) => entry.score);
  const hours = summary.totalMinutes / 60;

  return [
    { title: "First Step", detail: "Log any study session", done: summary.totalMinutes >= 1 || summary.actionsCount > 0 },
    { title: "5 Hour Club", detail: `${Math.min(hours, 5).toFixed(1)} / 5 hours studied`, done: hours >= 5 },
    { title: "3-Day Streak", detail: `${Math.min(summary.streak, 3)} / 3 days in a row`, done: summary.streak >= 3 },
    { title: "Test Taker", detail: `${Math.min(scores.length, 5)} / 5 scored attempts`, done: scores.length >= 5 },
    { title: "High Scorer", detail: "Score 80 or more once", done: scores.some((score) => score >= 80) },
    { title: "Explorer", detail: `${summary.featuresUsed} / 4 tools used`, done: summary.featuresUsed >= 4 }
  ];
}

function WeeklyChart({ weekly, today }) {
  const maxMinutes = Math.max(30, ...weekly.map((entry) => entry.minutes));
  const total = weekly.reduce((sum, entry) => sum + entry.minutes, 0);

  return (
    <section className="panel pg-panel">
      <header className="pg-panel-head">
        <div>
          <h2>Study time</h2>
          <p>Last 7 days &middot; {formatMinutes(total)} total</p>
        </div>
      </header>
      <div className="pg-bars" role="img" aria-label="Minutes studied on each of the last 7 days">
        {weekly.map((entry) => (
          <div className={`pg-bar-col ${entry.day === today ? "is-today" : ""}`} key={entry.day} title={`${weekdayLabel(entry.day)}: ${formatMinutes(entry.minutes)}`}>
            <span className="pg-bar-value">{entry.minutes >= 1 ? formatMinutes(entry.minutes) : ""}</span>
            <div className="pg-bar-track">
              <div className="pg-bar" style={{ height: `${(entry.minutes / maxMinutes) * 100}%` }} />
            </div>
            <span className="pg-bar-label">{entry.day === today ? "Today" : weekdayLabel(entry.day)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ScoreTrend({ scores, average }) {
  const [hovered, setHovered] = useState(null);
  const points = scores.slice(-12);
  const width = 560;
  const height = 230;
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (score) => pad.top + plotH - (score / 100) * plotH;
  const active = hovered !== null ? points[hovered] : null;

  return (
    <section className="panel pg-panel">
      <header className="pg-panel-head">
        <div>
          <h2>Score trend</h2>
          <p>Your last {points.length || ""} scored attempts</p>
        </div>
        {active ? (
          <div className="pg-readout">
            <strong>{active.score}</strong>
            <span>{active.label || FEATURE_LABELS[active.feature]} &middot; {shortDate(active.createdAt)}</span>
          </div>
        ) : null}
      </header>

      {points.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="pg-svg" role="img" aria-label="Score for each recent attempt, out of 100" onMouseLeave={() => setHovered(null)}>
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="pg-grid" />
              <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="pg-axis">{tick}</text>
            </g>
          ))}
          {average !== null ? (
            <g>
              <line x1={pad.left} x2={width - pad.right} y1={y(average)} y2={y(average)} className="pg-avg-line" />
              <text x={width - pad.right} y={y(average) - 6} textAnchor="end" className="pg-axis">avg {Math.round(average)}</text>
            </g>
          ) : null}
          <polyline className="pg-line" points={points.map((entry, index) => `${x(index)},${y(entry.score)}`).join(" ")} />
          {points.map((entry, index) => (
            <g key={`${entry.createdAt}-${index}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} tabIndex={0}>
              <rect x={x(index) - 18} y={pad.top} width="36" height={plotH} fill="transparent" />
              <circle cx={x(index)} cy={y(entry.score)} r={hovered === index ? 7 : 5} className="pg-dot" />
            </g>
          ))}
          <text x={pad.left} y={height - 6} className="pg-axis">Older</text>
          <text x={width - pad.right} y={height - 6} textAnchor="end" className="pg-axis">Latest</text>
        </svg>
      ) : (
        <div className="pg-empty">Take a quiz in Concept Explainer, a voice revision round, or an answer evaluation to see your scores here.</div>
      )}
    </section>
  );
}

function ChanceChart({ scores }) {
  const [target, setTarget] = useState(60);
  const model = useMemo(() => buildScoreModel(scores), [scores]);

  if (!model) {
    return (
      <section className="panel pg-panel">
        <header className="pg-panel-head">
          <div>
            <h2>Chance of hitting your target</h2>
            <p>Built from your past scores</p>
          </div>
        </header>
        <div className="pg-empty">Complete at least 2 scored attempts and Lakshya will estimate your chance of reaching a target score.</div>
      </section>
    );
  }

  const chance = Math.round(model.chanceAtLeast(target) * 100);
  const width = 760;
  const height = 240;
  const pad = { top: 20, right: 20, bottom: 32, left: 20 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const samples = Array.from({ length: 101 }, (_, value) => ({ value, density: model.density(value) }));
  const peak = Math.max(...samples.map((sample) => sample.density));
  const x = (value) => pad.left + (value / 100) * plotW;
  const y = (density) => pad.top + plotH - (density / peak) * plotH * 0.92;
  const baseline = pad.top + plotH;
  const curve = samples.map((sample) => `${x(sample.value)},${y(sample.density)}`).join(" ");
  const shaded = samples.filter((sample) => sample.value >= target);
  const shadedPath = shaded.length
    ? `M${x(target)},${baseline} ${shaded.map((sample) => `L${x(sample.value)},${y(sample.density)}`).join(" ")} L${x(100)},${baseline} Z`
    : "";
  const verdict = chance >= 75 ? "You're on track" : chance >= 45 ? "Within reach" : "Needs more practice";

  return (
    <section className="panel pg-panel">
      <header className="pg-panel-head">
        <div>
          <h2>Chance of hitting your target</h2>
          <p>Built from your {scores.length} scored attempts</p>
        </div>
        <div className="pg-chips" role="group" aria-label="Target score">
          {TARGETS.map((value) => (
            <button key={value} type="button" className={`chip ${target === value ? "active" : ""}`} aria-pressed={target === value} onClick={() => setTarget(value)}>
              {value}+
            </button>
          ))}
        </div>
      </header>

      <div className="pg-chance">
        <div className="pg-chance-headline">
          <strong>{chance}%</strong>
          <span>
            chance of scoring <b>{target} or more</b> on your next attempt &middot; {verdict}
          </span>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="pg-svg" role="img" aria-label={`Likely scores curve. ${chance}% chance of scoring ${target} or more.`}>
          {[0, 20, 40, 60, 80, 100].map((tick) => (
            <text key={tick} x={x(tick)} y={height - 8} textAnchor="middle" className="pg-axis">{tick}</text>
          ))}
          <line x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} className="pg-grid" />
          {shadedPath ? <path d={shadedPath} className="pg-chance-area" /> : null}
          <polyline points={curve} className="pg-chance-curve" />
          <line x1={x(target)} x2={x(target)} y1={pad.top} y2={baseline} className="pg-target-line" />
          <text x={x(target) + 6} y={pad.top + 10} className="pg-axis pg-axis-strong">Target {target}</text>
          <line x1={x(model.mean)} x2={x(model.mean)} y1={y(model.density(model.mean))} y2={baseline} className="pg-avg-line" />
          <text x={x(model.mean)} y={y(model.density(model.mean)) - 8} textAnchor="middle" className="pg-axis">Your average {Math.round(model.mean)}</text>
        </svg>

        <p className="pg-note">
          The curve shows which scores you're most likely to get next time — the taller it is, the more likely that score. The shaded part is the
          chance of reaching your target.
        </p>
      </div>
    </section>
  );
}

function TimeByFeature({ byFeature }) {
  const used = byFeature.filter((entry) => entry.minutes >= 1).sort((a, b) => b.minutes - a.minutes);
  const max = Math.max(1, ...used.map((entry) => entry.minutes));

  return (
    <section className="panel pg-panel">
      <header className="pg-panel-head">
        <div>
          <h2>Where your time goes</h2>
          <p>All-time study minutes by tool</p>
        </div>
      </header>
      {used.length ? (
        <ul className="pg-feature-list">
          {used.map((entry) => (
            <li key={entry.feature}>
              <div className="pg-feature-meta">
                <span>{FEATURE_LABELS[entry.feature]}</span>
                <span>{formatMinutes(entry.minutes)}</span>
              </div>
              <div className="pg-feature-track">
                <div className="pg-feature-fill" style={{ width: `${(entry.minutes / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pg-empty">Open any study tool from the sidebar — the time you spend there is tracked automatically.</div>
      )}
    </section>
  );
}

function RecentActivity({ recent }) {
  return (
    <section className="panel pg-panel">
      <header className="pg-panel-head">
        <div>
          <h2>Recent activity</h2>
          <p>Updates live as you study</p>
        </div>
      </header>
      {recent.length ? (
        <ul className="pg-activity">
          {recent.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.label || FEATURE_LABELS[entry.feature]}</strong>
                <span>
                  {FEATURE_LABELS[entry.feature]} &middot; {timeAgo(entry.createdAt)}
                </span>
              </div>
              {entry.type === "score" ? <em className="pg-score-pill">{entry.score}/100</em> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="pg-empty">Nothing logged yet. Ask a doubt, take a quiz, or build a study plan to get started.</div>
      )}
    </section>
  );
}

function ProgressPage() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  const loadSummary = useCallback(() => {
    progressApi
      .summary()
      .then((data) => {
        setSummary(data);
        setError("");
      })
      .catch((loadError) => setError(loadError.message));
  }, []);

  useEffect(() => {
    loadSummary();
    const timer = window.setInterval(loadSummary, REFRESH_MS);
    window.addEventListener("focus", loadSummary);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", loadSummary);
    };
  }, [loadSummary]);

  const scoreValues = useMemo(() => (summary?.scores || []).map((entry) => entry.score), [summary]);

  if (!summary) {
    return (
      <div className="progress-screen">
        <div className="screen-header">
          <div>
            <h1>My Progress</h1>
            <p>{error || "Loading your study history..."}</p>
          </div>
        </div>
      </div>
    );
  }

  const improvement = summary.improvement;
  const stats = [
    { icon: Clock3, label: "Total study time", value: formatMinutes(summary.totalMinutes), hint: `${summary.activeDays} active day${summary.activeDays === 1 ? "" : "s"}` },
    { icon: Flame, label: "Current streak", value: `${summary.streak} day${summary.streak === 1 ? "" : "s"}`, hint: summary.streak ? "Keep it going today" : "Study today to start one" },
    { icon: Target, label: "Average score", value: summary.averageScore !== null ? `${Math.round(summary.averageScore)}%` : "--", hint: `${summary.scores.length} scored attempt${summary.scores.length === 1 ? "" : "s"}` },
    {
      icon: TrendingUp,
      label: "Improvement",
      value: improvement !== null ? `${improvement >= 0 ? "+" : ""}${Math.round(improvement)} pts` : "--",
      hint: improvement !== null ? "Last 5 vs. previous 5 scores" : "Needs 6 scored attempts"
    }
  ];
  const achievements = buildAchievements(summary);
  const unlocked = achievements.filter((achievement) => achievement.done).length;

  return (
    <div className="progress-screen pg-screen">
      <div className="screen-header">
        <div>
          <h1>My Progress</h1>
          <p>Everything you study in Lakshya is recorded here automatically — time spent, scores, and how likely you are to hit your target.</p>
        </div>
      </div>

      {error ? <p className="pg-warning">Couldn't refresh just now: {error}</p> : null}

      <div className="pg-stats">
        {stats.map(({ icon: Icon, label, value, hint }) => (
          <article className="panel pg-stat" key={label}>
            <span className="pg-stat-label">
              <Icon size={16} aria-hidden="true" />
              {label}
            </span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </div>

      <div className="pg-grid-2">
        <WeeklyChart weekly={summary.weekly} today={summary.today} />
        <ScoreTrend scores={summary.scores} average={summary.averageScore} />
      </div>

      <ChanceChart scores={scoreValues} />

      <div className="pg-grid-2">
        <TimeByFeature byFeature={summary.byFeature} />
        <RecentActivity recent={summary.recent} />
      </div>

      <section className="panel pg-panel">
        <header className="pg-panel-head">
          <div>
            <h2>Achievements</h2>
            <p>
              {unlocked} of {achievements.length} unlocked
            </p>
          </div>
        </header>
        <div className="pg-achievements">
          {achievements.map((achievement) => (
            <div className={`pg-achievement ${achievement.done ? "is-done" : ""}`} key={achievement.title}>
              {achievement.done ? <Award size={22} aria-hidden="true" /> : <CalendarCheck size={22} aria-hidden="true" />}
              <strong>{achievement.title}</strong>
              <span>{achievement.done ? "Unlocked" : achievement.detail}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default ProgressPage;
