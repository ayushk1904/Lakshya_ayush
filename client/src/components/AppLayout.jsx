import {
  AlarmClock,
  CheckCheck,
  Compass,
  FileText,
  LayoutDashboard,
  LineChart,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Calendar
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import useStudyTimeTracker from "../hooks/useStudyTimeTracker";
import AutoStartProctorRedirect from "./AutoStartProctorRedirect";
import BrandLogo from "./BrandLogo";
import ThemeSwitcher from "./ThemeSwitcher";

const navItems = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/planner", label: "Study Planner", icon: Calendar },
  { to: "/app/explainer", label: "Concept Explainer", icon: Sparkles },
  { to: "/app/hub", label: "Study Hub", icon: Users },
  { to: "/app/tests", label: "Practice Tests", icon: FileText },
  { to: "/app/proctor", label: "Live AI Proctor", icon: ShieldCheck },
  { to: "/app/evaluator", label: "Answer Evaluator", icon: CheckCheck },
  { to: "/app/coach", label: "Last-Minute Coach", icon: AlarmClock },
  { to: "/app/progress", label: "My Progress", icon: LineChart }
];

const routeMeta = {
  "/app/dashboard": { eyebrow: "Mission Control", title: "Dashboard" },
  "/app/planner": { eyebrow: "Planning", title: "AI Study Planner" },
  "/app/tests": { eyebrow: "Practice", title: "Practice Tests" },
  "/app/explainer": { eyebrow: "Doubt Solving", title: "Concept Explainer" },
  "/app/evaluator": { eyebrow: "Evaluation", title: "Answer Evaluator" },
  "/app/hub": { eyebrow: "Collaboration", title: "Study Hub" },
  "/app/proctor": { eyebrow: "Exam Mode", title: "Live AI Proctor" },
  "/app/coach": { eyebrow: "Sprint Prep", title: "Last-Minute Coach" },
  "/app/progress": { eyebrow: "Analytics", title: "My Progress" },
  "/app/account-settings": { eyebrow: "Profile", title: "Account Settings" }
};

function getUserInitials(name) {
  const parts = String(name || "Student")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "S";
}

function AppLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, avatarUrl } = useAuth();
  const currentRoute = routeMeta[pathname] || { eyebrow: "Lakshya", title: "Workspace" };
  const isHubRoute = pathname === "/app/hub";
  const [isNavbarHidden, setIsNavbarHidden] = useState(false);
  useStudyTimeTracker(pathname);

  return (
    <div className={`app-shell ${isHubRoute ? "app-shell-hub" : ""} ${isNavbarHidden ? "app-shell-nav-hidden" : ""}`}>
      <AutoStartProctorRedirect />
      <div className="shell-glow shell-glow-left" aria-hidden="true" />
      <div className="shell-glow shell-glow-right" aria-hidden="true" />
      <button
        className={`menu-button nav-hide-button ${isNavbarHidden ? "active" : ""}`}
        type="button"
        aria-label={isNavbarHidden ? "Show navbar" : "Hide navbar"}
        aria-pressed={isNavbarHidden}
        title={isNavbarHidden ? "Show navbar" : "Hide navbar"}
        onClick={() => setIsNavbarHidden((current) => !current)}
      >
        <Menu size={18} />
      </button>
      <aside className={`sidebar ${isHubRoute ? "sidebar-hub" : ""}`}>
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

      <main className={`workspace ${isHubRoute ? "workspace-hub" : ""}`}>
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-copy">
              <span>{currentRoute.eyebrow}</span>
              <strong>{currentRoute.title}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <ThemeSwitcher />
            <button
              className="profile-button"
              type="button"
              aria-label="Open account settings"
              onClick={() => navigate("/app/account-settings")}
            >
              <span className="profile-avatar" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{getUserInitials(user?.name)}</span>}
              </span>
              <span className="profile-button-copy">
                <span>{user?.name || "Student"}</span>
                <strong>Account Settings</strong>
              </span>
              <Settings size={18} />
            </button>
          </div>
        </header>

        <section className={`content-area ${isHubRoute ? "content-area-hub" : ""}`}>
          <Outlet />
        </section>
      </main>
    </div>
  );
}

export default AppLayout;
