import { Mic, ScanFace, ShieldCheck, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { examApi } from "../api/client";

function ProctorPage() {
  const [session, setSession] = useState({ title: "Physics Mock Test", attentionScore: 92 });

  useEffect(() => {
    examApi.active().then((data) => setSession(data.session)).catch(() => {});
  }, []);

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1>Live AI Proctor Call</h1>
          <p>The exam opens only after the student joins the AI monitoring call.</p>
        </div>
      </div>

      <div className="proctor-grid">
        <section className="proctor-stage">
          <div className="call-badge">AI Call Connected</div>
          <div className="camera-frame">
            <div className="camera-overlay">
              <div className="scan-ring" />
              <div className="warning-box">
                <ScanFace size={18} />
                Face detected. Focus stable for {session.title}.
              </div>
            </div>
          </div>
          <div className="proctor-controls">
            <button className="primary-button compact">
              <Video size={16} />
              Camera Active
            </button>
            <button className="secondary-button compact">
              <Mic size={16} />
              Mic Monitoring
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>Integrity Signals</h2>
          </div>
          <div className="signal-list">
            <div className="signal-card">
              <strong>Visual Attention</strong>
              <span>{session.attentionScore || 92}% focused</span>
            </div>
            <div className="signal-card">
              <strong>Tab Switching</strong>
              <span>No anomalies</span>
            </div>
            <div className="signal-card">
              <strong>Ambient Noise</strong>
              <span>Low background noise</span>
            </div>
            <div className="signal-card alert">
              <strong>AI Intervention Script</strong>
              <p>"No cheating! Please focus on your paper and write honestly."</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default ProctorPage;
