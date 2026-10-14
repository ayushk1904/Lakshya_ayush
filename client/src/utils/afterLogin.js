export const AFTER_LOGIN_KEY = "lakshya_after_login";

// Returns the in-app page a logged-out visitor originally tried to open, defaulting to the dashboard.
export function consumeAfterLoginPath() {
  try {
    const path = sessionStorage.getItem(AFTER_LOGIN_KEY);
    sessionStorage.removeItem(AFTER_LOGIN_KEY);

    if (path && path.startsWith("/app/")) {
      return path;
    }
  } catch {
    // Fall through to the default.
  }

  return "/app/dashboard";
}
