import { BookOpen, Brain, ClipboardCheck, Clock3, Moon, Sparkles, Users } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";

const features = [
  { icon: Brain, title: "AI Study Planner", text: "Upload your syllabus and get a personalized day-by-day study plan." },
  { icon: Sparkles, title: "Concept Explainer", text: "Ask any question and get clear, exam-ready explanations instantly." },
  { icon: ClipboardCheck, title: "Answer Grader", text: "Upload handwritten answers and receive AI feedback with scores." },
  { icon: BookOpen, title: "Study Hub", text: "Collaborate with friends in real-time study rooms with AI support." },
  { icon: Clock3, title: "Mock Exams", text: "Simulate real exams with timer, focus mode, and instant grading." },
  { icon: Users, title: "Last Minute Coach", text: "Get a tight hourly plan when your exam is tomorrow." }
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
          <button className="ghost-icon" type="button" aria-label="Theme">
            <Moon size={18} />
          </button>
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
          <h1>Learn. Grow. Evolve.</h1>
          <p className="hero-copy">
            Lakshya combines intelligent planning, social study rooms, live AI proctoring, answer evaluation, and voice
            coaching in one focused platform for serious exam preparation.
          </p>
          <div className="hero-actions">
            <button className="primary-button large" onClick={() => navigate("/register")}>
              Create Account
            </button>
            <button className="secondary-button large" onClick={() => navigate("/login")}>
              Open Demo Flow
            </button>
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
    </div>
  );
}

export default LandingPage;
