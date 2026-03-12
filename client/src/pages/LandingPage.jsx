import { ArrowRight, BookOpen, Brain, ClipboardCheck, Clock3, Sparkles, Target, Users } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";
import ThemeSwitcher from "../components/ThemeSwitcher";

const features = [
  { icon: Brain, title: "AI Study Planner", text: "Upload your syllabus and get a personalized day-by-day study plan." },
  { icon: Sparkles, title: "Concept Explainer", text: "Ask any question and get clear, exam-ready explanations instantly." },
  { icon: ClipboardCheck, title: "Answer Grader", text: "Upload handwritten answers and receive AI feedback with scores." },
  { icon: BookOpen, title: "Study Hub", text: "Collaborate with friends in real-time study rooms with AI support." },
  { icon: Clock3, title: "Mock Exams", text: "Simulate real exams with timer, focus mode, and instant grading." },
  { icon: Users, title: "Last Minute Coach", text: "Get a tight hourly plan when your exam is tomorrow." }
];

const heroStats = [
  { value: "7", label: "study tools in one flow" },
  { value: "24/7", label: "AI support across sessions" },
  { value: "1", label: "workspace for serious prep" }
];

function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="nav-spacer" aria-hidden="true" />
        <div className="brand-block landing-brand-block">
          <BrandLogo />
        </div>
        <div className="nav-actions">
          <ThemeSwitcher />
          <Link className="secondary-button" to="/login">
            Login
          </Link>
          <Link className="primary-button" to="/register">
            Start Studying
          </Link>
        </div>
      </header>

      <section className="hero-panel">
        <div className="floating-orb orb-left" />
        <div className="floating-orb orb-right" />
        <div className="floating-square" />
        <div className="hero-content">
          <p className="eyebrow">AI-powered personalized study and exam workspace</p>
          <h1>Train like exam day already started.</h1>
          <p className="hero-copy">
            Lakshya combines intelligent planning, social study rooms, live AI proctoring, answer evaluation, and voice
            coaching in one focused platform for serious exam preparation.
          </p>
          <div className="hero-actions">
            <button className="primary-button large" onClick={() => navigate("/register")}>
              Create Account
              <ArrowRight size={16} />
            </button>
            <button className="secondary-button large" onClick={() => navigate("/login")}>
              Open Demo Flow
            </button>
          </div>
          <div className="hero-stats">
            {heroStats.map((item) => (
              <article className="hero-stat-card" key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>
            Everything you need to <span>ace your exams</span>
          </h2>
          <p>Powered by AI, designed for students who want to study smarter and perform better.</p>
        </div>

        <div className="feature-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article className="feature-card" key={feature.title}>
                <div className="feature-icon">
                  <Icon size={24} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="landing-section landing-showcase">
        <div className="landing-section-header">
          <h2>
            Built for <span>focus, speed, and feedback</span>
          </h2>
          <p>Not another generic dashboard. Lakshya is structured like a prep room with clear priorities and fast actions.</p>
        </div>

        <div className="spotlight-grid">
          <article className="spotlight-card proctor-card">
            <p className="spotlight-label">Exam pressure</p>
            <h3>Simulate the real thing</h3>
            <p>Run timed sessions, keep attention high, and let the AI watch for drift before exam habits become a problem.</p>
            <div className="spotlight-pills">
              <span>Timed</span>
              <span>Proctored</span>
              <span>Focused</span>
            </div>
          </article>

          <article className="spotlight-card hub-card">
            <p className="spotlight-label">Study together</p>
            <h3>Rooms that feel active</h3>
            <p>Move from solo prep into shared rooms, compare progress, and resolve doubts without leaving the workflow.</p>
            <div className="mini-chat">
              <span className="chip">Physics sprint at 6 PM</span>
              <span className="chip">AI summary in thread</span>
              <span className="chip">Revision cues ready</span>
            </div>
          </article>

          <article className="spotlight-card coach-card">
            <p className="spotlight-label">Last-day prep</p>
            <h3>Know what matters next</h3>
            <p>When time compresses, Lakshya shifts from broad planning to a tactical sequence of revision, testing, and recall.</p>
            <div className="spotlight-pills coach-pills">
              <span>Priority topics</span>
              <span>Hourly blocks</span>
              <span>Rapid review</span>
            </div>
          </article>
        </div>
      </section>

      <section className="landing-section mission-strip">
        <div className="mission-strip-card">
          <div>
            <p className="eyebrow">Lakshya mission</p>
            <h2>From scattered effort to targeted preparation.</h2>
          </div>
          <Link className="primary-button" to="/register">
            Start your prep stack
            <Target size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}

export default LandingPage;
