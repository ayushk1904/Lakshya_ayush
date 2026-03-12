import {
  AlarmClock,
  CheckCheck,
  Compass,
  FileText,
  LayoutDashboard,
  LineChart,
  Menu,
  ShieldCheck,
  Sparkles,
  Users,
  Calendar
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandLogo from "./BrandLogo";
import ThemeSwitcher from "./ThemeSwitcher";

const navItems = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/planner", label: "Study Planner", icon: Calendar },
  { to: "/app/tests", label: "Practice Tests", icon: FileText },
  { to: "/app/explainer", label: "Concept Explainer", icon: Sparkles },
  { to: "/app/evaluator", label: "Answer Evaluator", icon: CheckCheck },
  { to: "/app/hub", label: "Study Hub", icon: Users },
  { to: "/app/proctor", label: "Live AI Proctor", icon: ShieldCheck },
  { to: "/app/coach", label: "Last-Minute Coach", icon: AlarmClock },
  { to: "/app/progress", label: "My Progress", icon: LineChart }
];

const routeMeta = {
  "/app/dashboard": { eyebrow: "Mission Control", title: "Dashboard" },
  "/app/planner": { eyebrow: "Planning", title: "Study Planner" },
  "/app/tests": { eyebrow: "Practice", title: "Practice Tests" },
  "/app/explainer": { eyebrow: "Doubt Solving", title: "Concept Explainer" },
  "/app/evaluator": { eyebrow: "Evaluation", title: "Answer Evaluator" },
  "/app/hub": { eyebrow: "Collaboration", title: "Study Hub" },
  "/app/proctor": { eyebrow: "Exam Mode", title: "Live AI Proctor" },
  "/app/coach": { eyebrow: "Sprint Prep", title: "Last-Minute Coach" },
  "/app/progress": { eyebrow: "Analytics", title: "My Progress" }
};

function AppLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const currentRoute = routeMeta[pathname] || { eyebrow: "Lakshya", title: "Workspace" };

  return (
    <div className="app-shell">
      <div className="shell-glow shell-glow-left" aria-hidden="true" />
      <div className="shell-glow shell-glow-right" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand-block">
          <BrandLogo />
        </div>

        <div className="sidebar-intro">
          <span className="sidebar-kicker">Focused prep stack</span>
          <p>Planning, practice, collaboration, and exam control in one workspace.</p>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} to={item.to}>
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-icon">
            <Compass size={18} />
          </div>
          <div>
            <strong>Stay on track</strong>
            <p>Use the planner first, then jump into tests and hub sessions.</p>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" type="button" aria-label="Toggle navigation">
              <Menu size={18} />
            </button>
            <div className="topbar-copy">
              <span>{currentRoute.eyebrow}</span>
              <strong>{currentRoute.title}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <ThemeSwitcher />
            <div className="user-chip">
              <div className="user-chip-meta">
                <span>Welcome</span>
                <strong>{user?.name || "Student"}</strong>
              </div>
              <span>{user?.name || "Student"}</span>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="content-area">
          <Outlet />
        </section>
      </main>
    </div>
  );
}

export default AppLayout;
