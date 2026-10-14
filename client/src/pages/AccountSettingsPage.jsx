import { Bell, Camera, CheckCircle2, Lock, LogOut, Mail, PencilLine, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function getUserInitials(name) {
  const parts = String(name || "Student")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "S";
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Unable to read image file"));
    reader.readAsDataURL(file);
  });
}

async function createCroppedAvatar(dataUrl, zoom, offsetX, offsetY) {
  const image = await new Promise((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Unable to load selected image"));
    nextImage.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  const size = 512;
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare image crop");
  }

  const scale = zoom;
  const base = Math.max(size / image.width, size / image.height);
  const drawWidth = image.width * base * scale;
  const drawHeight = image.height * base * scale;
  const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
  const maxOffsetY = Math.max(0, (drawHeight - size) / 2);
  const normalizedOffsetX = (offsetX / 100) * maxOffsetX;
  const normalizedOffsetY = (offsetY / 100) * maxOffsetY;
  const drawX = (size - drawWidth) / 2 - normalizedOffsetX;
  const drawY = (size - drawHeight) / 2 - normalizedOffsetY;

  context.clearRect(0, 0, size, size);
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  return canvas.toDataURL("image/jpeg", 0.92);
}

function AccountSettingsPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { user, avatarUrl, setAvatarFromFile, clearAvatar, updateProfile, requestPasswordOtp, resetPasswordWithOtp, logout } = useAuth();
  const [activeSection, setActiveSection] = useState("profile");
  const [formValues, setFormValues] = useState({ name: user?.name || "", email: user?.email || "" });
  const [saveMessage, setSaveMessage] = useState("");
  const [avatarMessage, setAvatarMessage] = useState("");
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [passwordStep, setPasswordStep] = useState("request");
  const [passwordValues, setPasswordValues] = useState({ otp: "", newPassword: "", confirmPassword: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [cropSource, setCropSource] = useState("");
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);

  useEffect(() => {
    setFormValues({
      name: user?.name || "",
      email: user?.email || ""
    });
  }, [user?.name, user?.email]);

  useEffect(() => {
    setPasswordMessage("");
    setPasswordError("");
    setPasswordStep("request");
    setPasswordValues({ otp: "", newPassword: "", confirmPassword: "" });
  }, [user?.email]);

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCropSource(dataUrl);
      setCropZoom(1);
      setCropX(0);
      setCropY(0);
      setAvatarMessage("");
    } catch (error) {
      setAvatarMessage(error.message || "Unable to open image editor.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleApplyCrop() {
    setIsSavingAvatar(true);
    setAvatarMessage("");

    try {
      const croppedAvatar = await createCroppedAvatar(cropSource, cropZoom, cropX, cropY);
      await setAvatarFromFile(croppedAvatar);
      setCropSource("");
    } catch (error) {
      setAvatarMessage(error.message || "Unable to update profile photo.");
    } finally {
      setIsSavingAvatar(false);
    }
  }

  async function handleProfileSave(event) {
    event.preventDefault();
    setIsSavingProfile(true);
    setSaveMessage("");

    try {
      const response = await updateProfile(formValues);
      setSaveMessage(response.message || "Profile updated successfully.");
    } catch (error) {
      setSaveMessage(error.message || "Unable to update your profile.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handlePasswordRequest(event) {
    event.preventDefault();
    setIsSubmittingPassword(true);
    setPasswordError("");
    setPasswordMessage("");

    try {
      const response = await requestPasswordOtp({ email: user?.email || "" });
      setPasswordMessage(response.message || "OTP sent to your registered email.");
      setPasswordStep("reset");
    } catch (error) {
      setPasswordError(error.message || "Unable to send password reset OTP.");
    } finally {
      setIsSubmittingPassword(false);
    }
  }

  async function handlePasswordReset(event) {
    event.preventDefault();

    if (passwordValues.newPassword !== passwordValues.confirmPassword) {
      setPasswordError("New password and confirm password do not match.");
      setPasswordMessage("");
      return;
    }

    setIsSubmittingPassword(true);
    setPasswordError("");
    setPasswordMessage("");

    try {
      const response = await resetPasswordWithOtp({
        email: user?.email || "",
        otp: passwordValues.otp,
        newPassword: passwordValues.newPassword
      });
      setPasswordMessage(response.message || "Password updated successfully.");
      setPasswordStep("request");
      setPasswordValues({ otp: "", newPassword: "", confirmPassword: "" });
    } catch (error) {
      setPasswordError(error.message || "Unable to update your password.");
    } finally {
      setIsSubmittingPassword(false);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const hasProfileChanges = formValues.name !== (user?.name || "") || formValues.email !== (user?.email || "");

  return (
    <div className="account-screen">
      <div className="account-title-block">
        <h1>Account Settings</h1>
        <p>Manage your profile details and avatar from one place.</p>
      </div>

      <section className="panel account-shell-panel">
        <div className="account-shell-layout">
          <aside className="account-sidebar-nav">
            <div className="account-sidebar-group">
              <span className="account-sidebar-label">Account</span>
              <button className={`account-nav-item${activeSection === "profile" ? " active" : ""}`} type="button" onClick={() => setActiveSection("profile")}>
                <UserRound size={16} />
                <span>Profile Name</span>
              </button>
              <button className="account-nav-item" type="button" disabled>
                <Bell size={16} />
                <span>Notification Settings</span>
              </button>
              <button className={`account-nav-item${activeSection === "password" ? " active" : ""}`} type="button" onClick={() => setActiveSection("password")}>
                <Lock size={16} />
                <span>Password</span>
              </button>
            </div>

            <button className="account-nav-item account-nav-logout" type="button" onClick={handleLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </aside>

          <div className="account-editor">
            <div className="account-editor-header">
              <h2>{activeSection === "profile" ? "Edit Your Profile" : "Update Your Password"}</h2>
              <p>
                {activeSection === "profile"
                  ? "Keep your public details and header avatar updated."
                  : "Request an OTP on your registered email, then set a new password securely."}
              </p>
            </div>

            {activeSection === "profile" ? (
              <form className="account-form" onSubmit={handleProfileSave}>
                <label className="account-field">
                  <span>Full Name</span>
                  <div className="account-input-shell">
                    <PencilLine size={16} />
                    <input
                      type="text"
                      value={formValues.name}
                      onChange={(event) => setFormValues((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Enter your full name"
                    />
                  </div>
                </label>

                <label className="account-field">
                  <span>Email</span>
                  <div className="account-input-shell">
                    <Mail size={16} />
                    <input
                      type="email"
                      value={formValues.email}
                      onChange={(event) => setFormValues((current) => ({ ...current, email: event.target.value }))}
                      placeholder="Enter your Gmail"
                    />
                  </div>
                </label>

                <div className="account-form-footer">
                  <div className="account-form-state">
                    <CheckCircle2 size={16} />
                    <span>{hasProfileChanges ? "Unsaved changes ready to apply" : "Profile is up to date"}</span>
                  </div>
                  <button className="primary-button compact account-save-button" type="submit" disabled={isSavingProfile || !hasProfileChanges}>
                    {isSavingProfile ? "Saving..." : "Save Change"}
                  </button>
                </div>

                {saveMessage ? <p className="auth-banner">{saveMessage}</p> : null}
              </form>
            ) : (
              <form className="account-form" onSubmit={passwordStep === "request" ? handlePasswordRequest : handlePasswordReset}>
                <label className="account-field">
                  <span>Registered Email</span>
                  <div className="account-input-shell">
                    <Mail size={16} />
                    <input type="email" value={user?.email || ""} readOnly />
                  </div>
                </label>

                {passwordStep === "reset" ? (
                  <>
                    <label className="account-field">
                      <span>OTP</span>
                      <div className="account-input-shell">
                        <Lock size={16} />
                        <input
                          type="text"
                          value={passwordValues.otp}
                          onChange={(event) => setPasswordValues((current) => ({ ...current, otp: event.target.value }))}
                          placeholder="Enter the 6 digit OTP"
                        />
                      </div>
                    </label>

                    <label className="account-field">
                      <span>New Password</span>
                      <div className="account-input-shell">
                        <Lock size={16} />
                        <input
                          type="password"
                          value={passwordValues.newPassword}
                          onChange={(event) => setPasswordValues((current) => ({ ...current, newPassword: event.target.value }))}
                          placeholder="Enter your new password"
                        />
                      </div>
                    </label>

                    <label className="account-field">
                      <span>Confirm Password</span>
                      <div className="account-input-shell">
                        <Lock size={16} />
                        <input
                          type="password"
                          value={passwordValues.confirmPassword}
                          onChange={(event) => setPasswordValues((current) => ({ ...current, confirmPassword: event.target.value }))}
                          placeholder="Re-enter your new password"
                        />
                      </div>
                    </label>
                  </>
                ) : null}

                <div className="account-form-footer">
                  <div className="account-form-state">
                    <CheckCircle2 size={16} />
                    <span>{passwordStep === "request" ? "Send an OTP to start password reset" : "Enter the OTP and choose a new password"}</span>
                  </div>
                  <button className="primary-button compact account-save-button" type="submit" disabled={isSubmittingPassword}>
                    {isSubmittingPassword ? "Please wait..." : passwordStep === "request" ? "Send OTP" : "Reset Password"}
                  </button>
                </div>

                {passwordStep === "reset" ? (
                  <button className="text-button auth-link-button" type="button" onClick={() => setPasswordStep("request")}>
                    Use a different reset attempt
                  </button>
                ) : null}

                {passwordError ? <p className="error-banner">{passwordError}</p> : null}
                {passwordMessage ? <p className="success-banner auth-banner">{passwordMessage}</p> : null}
              </form>
            )}
          </div>

          <aside className="account-avatar-panel">
            <div className="account-avatar-card">
              <div className="account-avatar-preview" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{getUserInitials(user?.name)}</span>}
              </div>

              <input
                ref={fileInputRef}
                className="account-file-input"
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
              />

              <button className="secondary-button compact account-avatar-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={isSavingAvatar}>
                <Camera size={16} />
                {isSavingAvatar ? "Saving..." : "Change avatar"}
              </button>

              {avatarUrl ? (
                <button className="text-button account-remove-button" type="button" onClick={clearAvatar}>
                  Remove current photo
                </button>
              ) : null}

              {avatarMessage && !avatarUrl ? <p className="planner-note">{avatarMessage}</p> : null}
            </div>
          </aside>
        </div>
      </section>

      {cropSource ? (
        <div className="account-crop-overlay" role="dialog" aria-modal="true" aria-label="Crop profile photo">
          <div className="account-crop-panel">
            <div className="account-crop-header">
              <div>
                <p className="eyebrow">Avatar editor</p>
                <h2>Crop your photo</h2>
                <p>Position your image inside the frame, then apply it when it looks right.</p>
              </div>
              <button className="ghost-icon" type="button" onClick={() => setCropSource("")} aria-label="Close crop editor">
                <X size={18} />
              </button>
            </div>

            <div className="account-crop-body">
              <div className="account-crop-stage">
                <div className="account-crop-preview">
                  <img
                    src={cropSource}
                    alt="Crop preview"
                    style={{
                      transform: `translate(${cropX}px, ${cropY}px) scale(${cropZoom})`
                    }}
                  />
                </div>
              </div>

              <div className="account-crop-controls">
                <label className="account-slider-field">
                  <span>Zoom</span>
                  <input type="range" min="1" max="3" step="0.01" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} />
                </label>
                <label className="account-slider-field">
                  <span>Move Left / Right</span>
                  <input type="range" min="-100" max="100" step="1" value={cropX} onChange={(event) => setCropX(Number(event.target.value))} />
                </label>
                <label className="account-slider-field">
                  <span>Move Up / Down</span>
                  <input type="range" min="-100" max="100" step="1" value={cropY} onChange={(event) => setCropY(Number(event.target.value))} />
                </label>

                <div className="account-crop-actions">
                  <button className="secondary-button compact" type="button" onClick={() => setCropSource("")}>
                    Cancel
                  </button>
                  <button className="primary-button compact" type="button" onClick={handleApplyCrop} disabled={isSavingAvatar}>
                    {isSavingAvatar ? "Applying..." : "Apply Avatar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AccountSettingsPage;
