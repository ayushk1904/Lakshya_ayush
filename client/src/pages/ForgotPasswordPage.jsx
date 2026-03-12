import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";
import ThemeSwitcher from "../components/ThemeSwitcher";
import { useAuth } from "../context/AuthContext";

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { requestPasswordOtp, resetPasswordWithOtp } = useAuth();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [step, setStep] = useState("request");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRequestOtp(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setStatus("");

    try {
      const data = await requestPasswordOtp({ email });
      setStatus(data.message);
      setStep("reset");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setStatus("");

    try {
      await resetPasswordWithOtp({ email, otp, newPassword });
      navigate("/app/dashboard");
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-toolbar">
        <ThemeSwitcher />
      </div>
      <form className="auth-card auth-card-tight" onSubmit={step === "request" ? handleRequestOtp : handleReset}>
        <div className="brand-block">
          <BrandLogo />
        </div>
        <h1>Forgot Password</h1>
        <p className="auth-copy">Use your registered Gmail account to receive an OTP and reset your Lakshya password.</p>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="yourname@gmail.com" />
        {step === "reset" ? (
          <>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6 digit OTP" />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
            />
          </>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {status ? <div className="success-banner auth-banner">{status}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Please wait..." : step === "request" ? "Send OTP" : "Reset Password"}
        </button>
        {step === "reset" ? (
          <button className="text-button auth-link-button" type="button" onClick={() => setStep("request")}>
            Use a different Gmail address
          </button>
        ) : null}
        <Link className="auth-link" to="/login">
          Back to login
        </Link>
      </form>
    </div>
  );
}

export default ForgotPasswordPage;
