import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/lib/auth-errors";

describe("readable authentication errors", () => {
  it("replaces the provider's character dump with clear password guidance", () => {
    const message = authErrorMessage({ code: "weak_password", message: "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$" }, "update-password");
    expect(message).toContain("uppercase and lowercase letters, a number, and a symbol");
    expect(message).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
  it("handles older password-policy responses without a code", () => {
    expect(authErrorMessage({ message: "Password should contain at least one character of each: abc" }, "signup")).toContain("stronger password");
  });
  it("preserves actionable minimum-length guidance", () => {
    expect(authErrorMessage({ code: "weak_password", message: "Password should be at least 12 characters." }, "signup")).toBe("Use a password with at least 12 characters.");
  });
  it.each([
    ["invalid_credentials", "Check your email and password, then try again."],
    ["email_not_confirmed", "Confirm your email using the link in your inbox, then sign in."],
    ["same_password", "Choose a different password from your current one."],
    ["otp_expired", "That code is invalid or expired. Request a new code and try again."],
  ])("explains %s", (code, message) => {
    expect(authErrorMessage({ code }, "signin")).toBe(message);
  });
  it("handles rate limits even without a provider code", () => {
    expect(authErrorMessage({ status: 429 }, "reset")).toContain("Wait a few minutes");
  });
  it("does not expose unknown backend errors", () => {
    expect(authErrorMessage({ message: "Database error saving new user: internal schema" }, "signup")).toBe("We couldn't create your account. Please try again.");
  });
  it("explains network failures without showing technical details", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"), "signin")).toContain("Check your connection");
  });
  it("handles an unknown thrown value", () => {
    expect(authErrorMessage(null, "update-password")).toBe("We couldn't update your password. Please try again.");
  });
});
