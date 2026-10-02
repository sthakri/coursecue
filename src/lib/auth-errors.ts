type AuthAction = "signin" | "signup" | "reset" | "verify-code" | "update-password";

const fallback: Record<AuthAction, string> = {
  signin: "We couldn't sign you in. Please try again.",
  signup: "We couldn't create your account. Please try again.",
  reset: "We couldn't send your reset code. Please try again.",
  "verify-code": "We couldn't verify your code. Please try again.",
  "update-password": "We couldn't update your password. Please try again.",
};

/** Translate provider errors; never show raw backend messages in the UI. */
export function authErrorMessage(error: unknown, action: AuthAction): string {
  const details = error && typeof error === "object"
    ? error as { code?: string; message?: string; status?: number; name?: string; reasons?: string[] }
    : {};
  const code = details.code;
  const message = typeof details.message === "string" ? details.message : "";

  if (details.status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return "Too many attempts. Wait a few minutes, then try again.";
  }
  if (code === "weak_password" || /password should (contain|be at least)/i.test(message)) {
    if (details.reasons?.includes("pwned")) {
      return "This password has appeared in a data breach. Choose a different password.";
    }
    const minimum = message.match(/at least (\d+) characters/i);
    if (minimum) return `Use a password with at least ${minimum[1]} characters.`;
    return "Use a stronger password with uppercase and lowercase letters, a number, and a symbol.";
  }
  switch (code) {
    case "invalid_credentials": return "Check your email and password, then try again.";
    case "email_not_confirmed": return "Confirm your email using the link in your inbox, then sign in.";
    case "email_exists":
    case "user_already_exists": return "An account already uses this email. Sign in or reset your password.";
    case "email_address_invalid": return "Enter a valid email address and try again.";
    case "same_password": return "Choose a different password from your current one.";
    case "otp_expired": return "That code is invalid or expired. Request a new code and try again.";
    case "session_expired":
    case "session_not_found":
    case "reauthentication_needed": return "Your session has expired. Sign in again or request a new reset code.";
  }
  if (details.name === "AuthSessionMissingError") {
    return "Your session has expired. Sign in again or request a new reset code.";
  }
  if (details.name === "AuthRetryableFetchError" || /failed to fetch|network|fetch failed/i.test(message)) {
    return "We couldn't connect. Check your connection and try again.";
  }
  return fallback[action];
}
