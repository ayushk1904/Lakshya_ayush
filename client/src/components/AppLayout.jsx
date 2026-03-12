import {
  AlarmClock,
  CheckCheck,
  FileText,
  LayoutDashboard,
  LineChart,
  Menu,
  Moon,
  ShieldCheck,
  Sparkles,
  Users,
  Calendar
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandLogo from "./BrandLogo";

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

function AppLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <BrandLogo />
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
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" type="button" aria-label="Toggle navigation">
              <Menu size={18} />
            </button>
            <BrandLogo compact />
          </div>

          <div className="topbar-right">
            <button className="ghost-icon" type="button" aria-label="Theme">
              <Moon size={18} />
            </button>
            <div className="user-chip">
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
