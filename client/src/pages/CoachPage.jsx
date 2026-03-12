import { AlarmClock, Mic, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { studyPlanApi } from "../api/client";
import { fallbackCoach } from "../data/demoData";

function CoachPage() {
  const [coach, setCoach] = useState(fallbackCoach);

  useEffect(() => {
    studyPlanApi.lastMinute().then((data) => setCoach(data.coach)).catch(() => {});
  }, []);

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1>Last-Minute Strategy & Voice Coach</h1>
          <p>When the exam is tomorrow, Lakshya compresses your syllabus into an hourly execution roadmap.</p>
        </div>
      </div>

      <div className="coach-grid">
        <section className="panel gradient-panel soft">
          <div className="panel-title light">
            <Target size={18} />
            <h2>Priority Summary</h2>
          </div>
          <p>{coach.summary}</p>
          <div className="voice-callout">
            <Mic size={18} />
            <span>"{coach.voicePrompt}"</span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <AlarmClock size={18} />
            <h2>Hourly Roadmap</h2>
          </div>
          <div className="roadmap-list">
            {coach.roadmap.map((item) => (
              <div className="roadmap-row" key={item.time}>
                <div>
                  <strong>{item.time}</strong>
                  <p>{item.task}</p>
                </div>
                <span>{item.note}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default CoachPage;
