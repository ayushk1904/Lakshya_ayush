import { useState } from "react";
import { fallbackProgress } from "../data/demoData";

function ProgressPage() {
  const [progress] = useState(fallbackProgress);
  const maxHours = Math.max(...progress.weeklyHours);
  const scorePoints = progress.trendScores.map((score, index) => `${index * 115 + 30},${180 - score * 1.5}`).join(" ");

  return (
    <div className="progress-screen">
      <div className="screen-header">
        <div>
          <h1>My Progress</h1>
          <p>Track consistency, performance trends, and subject-wise mastery over time.</p>
        </div>
      </div>

      <div className="stats-grid">
        {progress.stats.map(([label, value]) => (
          <article className="progress-stat panel" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="chart-grid">
        <section className="panel progress-panel">
          <h2>Weekly Study Time</h2>
          <div className="bars">
            {progress.weeklyHours.map((value, index) => (
              <div className="bar-column" key={index}>
                <div className="bar" style={{ height: `${(value / maxHours) * 190}px` }} />
                <span>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel progress-panel">
          <h2>Score Trend</h2>
          <svg viewBox="0 0 400 220" className="trend-chart" aria-label="Score trend">
            <polyline fill="none" stroke="#7fe08b" strokeWidth="4" points={scorePoints} />
            {progress.trendScores.map((score, index) => (
              <circle key={index} cx={index * 115 + 30} cy={180 - score * 1.5} r="8" fill="#7fe08b" />
            ))}
          </svg>
          <div className="trend-labels">
            <span>Week 1</span>
            <span>Week 2</span>
            <span>Week 3</span>
            <span>Week 4</span>
          </div>
        </section>
      </div>

      <section className="panel progress-panel">
        <h2>Subject-wise Progress</h2>
        <div className="subject-list">
          {progress.subjects.map(([name, value, tone]) => (
            <div className="subject-row" key={name}>
              <div className="progress-meta">
                <span>{name}</span>
                <span>{value}/100</span>
              </div>
              <div className="progress-track">
                <div className={`progress-fill ${tone}`} style={{ width: `${value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel progress-panel">
        <h2>Achievements</h2>
        <div className="achievement-grid">
          {progress.achievements.map((achievement, index) => (
            <div className={`achievement-card ${index === 2 || index === 4 ? "muted" : ""}`} key={achievement}>
              <span>{achievement}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default ProgressPage;
