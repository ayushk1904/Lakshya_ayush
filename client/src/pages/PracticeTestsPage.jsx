import { Clock3 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { examApi } from "../api/client";

function PracticeTestsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function startExam() {
    setLoading(true);
    try {
      await examApi.start({ title: "Physics Mock Test", mode: "focus" });
    } finally {
      setLoading(false);
      navigate("/app/proctor");
    }
  }

  return (
    <div className="screen narrow">
      <section className="upload-panel exam-launch">
        <div className="upload-icon">
          <Clock3 size={42} />
        </div>
        <h1>Mock Exam</h1>
        <p>3 questions - 15 minutes</p>
        <span className="subtle">Focus mode will detect tab switching and can escalate to the live proctor flow.</span>
        <button className="primary-button wide" onClick={startExam} disabled={loading}>
          {loading ? "Starting..." : "Start with Focus Mode"}
        </button>
        <button className="secondary-button wide">Start without Focus Mode</button>
      </section>
    </div>
  );
}

export default PracticeTestsPage;
