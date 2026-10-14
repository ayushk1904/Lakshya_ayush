import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ThemeSwitcher from "../components/ThemeSwitcher";
import { useAuth } from "../context/AuthContext";
import { consumeAfterLoginPath } from "../utils/afterLogin";
import BrandLogo from "../components/BrandLogo";

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await login(form);
      navigate(consumeAfterLoginPath());
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-toolbar">
        <ThemeSwitcher />
      </div>
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="brand-block">
          <BrandLogo />
        </div>
        <h1>Login</h1>
        <p>Sign in with your registered Gmail account.</p>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="yourname@gmail.com"
        />
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="Password"
        />
        {error ? <div className="error-banner">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>
        <Link className="auth-link" to="/forgot-password">
          Forgot password? Use OTP
        </Link>
        <Link className="auth-link" to="/register">
          Need an account? Register
        </Link>
      </form>
    </div>
  );
}

export default LoginPage;
