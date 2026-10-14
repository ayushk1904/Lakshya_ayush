import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { useAuth } from "./context/AuthContext";
import AnswerEvaluatorPage from "./pages/AnswerEvaluatorPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import CoachPage from "./pages/CoachPage";
import ConceptExplainerPage from "./pages/ConceptExplainerPage";
import DashboardPage from "./pages/DashboardPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import PlannerPage from "./pages/PlannerPage";
import PracticeTestsPage from "./pages/PracticeTestsPage";
import ProgressPage from "./pages/ProgressPage";
import ProctorPage from "./pages/ProctorPage";
import RegisterPage from "./pages/RegisterPage";
import StudyHubPage from "./pages/StudyHubPage";
import { AFTER_LOGIN_KEY } from "./utils/afterLogin";

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="page-loader">Loading Lakshya...</div>;
  }

  if (!isAuthenticated) {
    // Remember where the visitor was going (e.g. a study room invite link) so login/register can send them back.
    try {
      sessionStorage.setItem(AFTER_LOGIN_KEY, `${location.pathname}${location.search}`);
    } catch {
      // Storage can be unavailable in private mode; the visitor just lands on the dashboard.
    }
    return <Navigate to="/login" replace />;
  }

  return <AppLayout />;
}

// Older invite links pointed at /studyhub?room=<id>; keep them working.
function LegacyStudyHubRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/app/hub${search}`} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/studyhub" element={<LegacyStudyHubRedirect />} />

      <Route path="/app" element={<ProtectedRoute />}>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="tests" element={<PracticeTestsPage />} />
        <Route path="account-settings" element={<AccountSettingsPage />} />
        <Route path="explainer" element={<ConceptExplainerPage />} />
        <Route path="evaluator" element={<AnswerEvaluatorPage />} />
        <Route path="hub" element={<StudyHubPage />} />
        <Route path="proctor" element={<ProctorPage />} />
        <Route path="coach" element={<CoachPage />} />
        <Route path="progress" element={<ProgressPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
