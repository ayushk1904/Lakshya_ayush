import { ArrowRight, BookOpen, Brain, ClipboardCheck, Clock3, PhoneCall, Sparkles, Upload, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { examApi, studyPlanApi } from "../api/client";
import { fallbackDashboard } from "../data/demoData";
import { useAuth } from "../context/AuthContext";

const quickActions = [
  { icon: Brain, title: "Ask AI", to: "/app/explainer" },
  { icon: Upload, title: "Upload Syllabus", to: "/app/planner" },
  { icon: ClipboardCheck, title: "Mock Exam", to: "/app/tests" },
  { icon: Users, title: "Study Room", to: "/app/hub" }
];

function DashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(fallbackDashboard);

  useEffect(() => {
    Promise.allSettled([studyPlanApi.today(), examApi.upcoming()]).then(([planResult, examsResult]) => {
      setDashboard({
        studyProgress: planResult.status === "fulfilled" ? planResult.value.studyProgress : fallbackDashboard.studyProgress,
        todayPlan: planResult.status === "fulfilled" ? planResult.value.todayPlan : fallbackDashboard.todayPlan,
        upcomingExams: examsResult.status === "fulfilled" ? examsResult.value.exams : fallbackDashboard.upcomingExams
      });
    });
  }, []);

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1>Welcome back, {user?.name || "Student"}!</h1>
          <p>Let's make today productive with Lakshya's social study and exam tools.</p>
        </div>
      </div>

      <div className="quick-grid">
        {quickActions.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} className="quick-card quick-link" to={item.to}>
              <div className="feature-icon">
                <Icon size={24} />
              </div>
              <span>{item.title}</span>
            </Link>
          );
        })}
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-title">
            <Sparkles size={18} />
            <h2>Study Progress</h2>
          </div>
          <div className="progress-list">
            {dashboard.studyProgress.map((subject) => (
              <div key={subject.name} className="progress-row">
                <div className="progress-meta">
                  <span>{subject.name}</span>
                  <span>{subject.value}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${subject.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <BookOpen size={18} />
            <h2>Today's Plan</h2>
          </div>
          <div className="timeline">
            {dashboard.todayPlan.map((item) => (
              <div className="timeline-row" key={item.time}>
                <span className="timeline-time">{item.time}</span>
                <div className="timeline-task">
                  <strong>{item.task}</strong>
                  <span className={`tag ${item.tag}`}>{item.tag}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <Clock3 size={18} />
            <h2>Upcoming Exams</h2>
          </div>
          <div className="exam-list">
            {dashboard.upcomingExams.map((exam) => (
              <div className="exam-card" key={exam._id || exam.title}>
                <div>
                  <strong>{exam.title}</strong>
                  <p>{exam.date}</p>
                </div>
                <span>{exam.count}</span>
              </div>
            ))}
          </div>
          <div className="button-row">
            <Link className="secondary-button compact" to="/app/proctor">
              Start Exam
            </Link>
            <Link className="secondary-button compact" to="/app/coach">
              Last Min
            </Link>
          </div>
        </section>
      </div>

      <div className="dual-highlight">
        <article className="highlight-panel gradient-panel">
          <div className="panel-title light">
            <Users size={18} />
            <h2>Real-Time Study Hub</h2>
          </div>
          <p>Jump into a subject room, talk over voice/video, and let the AI resolve doubts instantly inside the chat.</p>
          <Link className="light-button" to="/app/hub">
            Open Study Hub <ArrowRight size={16} />
          </Link>
        </article>

        <article className="highlight-panel dark-outline">
          <div className="panel-title">
            <PhoneCall size={18} />
            <h2>Live AI Proctor</h2>
          </div>
          <p>The AI joins the exam as a live call, monitors attention, and verbally intervenes if focus breaks.</p>
          <Link className="secondary-button compact" to="/app/proctor">
            View Proctor Flow
          </Link>
        </article>
      </div>
    </div>
  );
}

export default DashboardPage;
