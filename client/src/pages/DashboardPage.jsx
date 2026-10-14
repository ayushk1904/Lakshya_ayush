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

const dashboardFeatureGroups = [
  {
    title: "Study Progress",
    icon: Sparkles,
    actions: [
      { label: "My Progress", to: "/app/progress" },
      { label: "Dashboard", to: "/app/dashboard" }
    ]
  },
  {
    title: "Today's Plan",
    icon: BookOpen,
    actions: [
      { label: "Study Planner", to: "/app/planner" },
      { label: "Concept Explainer", to: "/app/explainer" }
    ]
  },
  {
    title: "Upcoming Exams",
    icon: Clock3,
    actions: [
      { label: "Practice Tests", to: "/app/tests" },
      { label: "Last-Minute Coach", to: "/app/coach" }
    ]
  }
];

function DashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(fallbackDashboard);
  const studyProgress = dashboard.studyProgress || fallbackDashboard.studyProgress;
  const todayPlan = dashboard.todayPlan || fallbackDashboard.todayPlan;
  const upcomingExams = dashboard.upcomingExams || fallbackDashboard.upcomingExams;

  useEffect(() => {
    Promise.allSettled([studyPlanApi.today(), examApi.upcoming()]).then(([planResult, examsResult]) => {
      setDashboard({
        studyProgress:
          planResult.status === "fulfilled" ? planResult.value.studyProgress || fallbackDashboard.studyProgress : fallbackDashboard.studyProgress,
        todayPlan: planResult.status === "fulfilled" ? planResult.value.todayPlan || fallbackDashboard.todayPlan : fallbackDashboard.todayPlan,
        upcomingExams: examsResult.status === "fulfilled" ? examsResult.value.exams || fallbackDashboard.upcomingExams : fallbackDashboard.upcomingExams
      });
    });
  }, []);

  return (
    <div className="screen dashboard-entrance">
      <div className="screen-header dashboard-entrance-block dashboard-entrance-header">
        <div>
          <h1>Welcome back, {user?.name || "Student"}!</h1>
          <p>Let's make today productive with Lakshya's social study and exam tools.</p>
        </div>
      </div>

      <div className="quick-grid dashboard-entrance-block dashboard-entrance-quick">
        {quickActions.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} className="quick-card quick-link dashboard-entrance-item" to={item.to}>
              <div className="feature-icon">
                <Icon size={24} />
              </div>
              <span>{item.title}</span>
            </Link>
          );
        })}
      </div>

      <div className="dashboard-grid dashboard-entrance-block dashboard-entrance-main">
        {dashboardFeatureGroups.map((group) => {
          const Icon = group.icon;
          return (
            <section className="panel dashboard-feature-panel dashboard-entrance-item" key={group.title}>
              <div className="panel-title">
                <Icon size={18} />
                <h2>{group.title}</h2>
              </div>
              <div className="dashboard-action-stack">
                {group.actions.map((action) => (
                  <Link className="dashboard-feature-link" key={action.label} to={action.to}>
                    <span>{action.label}</span>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="dual-highlight dashboard-entrance-block dashboard-entrance-highlight">
        <article className="highlight-panel gradient-panel dashboard-feature-panel dashboard-entrance-item">
          <div className="panel-title light">
            <Users size={18} />
            <h2>Real-Time Study Hub</h2>
          </div>
          <Link className="light-button dashboard-hero-link" to="/app/hub">
            Open Study Hub
            <ArrowRight size={16} />
          </Link>
        </article>

        <article className="highlight-panel dark-outline dashboard-feature-panel dashboard-entrance-item">
          <div className="panel-title">
            <PhoneCall size={18} />
            <h2>Live AI Proctor</h2>
          </div>
          <Link className="secondary-button compact dashboard-hero-link" to="/app/tests">
            Schedule Proctor Flow
          </Link>
        </article>
      </div>
    </div>
  );
}

export default DashboardPage;
