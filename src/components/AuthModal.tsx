import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Headphones, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  saveRememberSession,
} from "../lib/supabase";

export type AuthMode = "signin" | "signup" | "recovery";

type AuthModalProps = {
  initialMode: AuthMode;
  onAuthClientChanged: (client: SupabaseClient) => void;
  onClose: () => void;
};

type FormErrors = Partial<
  Record<
    | "fullName"
    | "username"
    | "email"
    | "password"
    | "confirmPassword"
    | "phone"
    | "recoveryCode",
    string
  >
>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-zA-Z0-9._]{3,20}$/;
const kenyanPhonePattern = /^\+254[17]\d{8}$/;

function validateForm(values: {
  mode: AuthMode;
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  recoveryCode: string;
  recoveryStage: "request" | "reset";
}): FormErrors {
  const errors: FormErrors = {};

  if (!emailPattern.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (values.mode === "recovery") {
    if (values.recoveryStage === "reset") {
      if (!/^\d{6}$/.test(values.recoveryCode)) {
        errors.recoveryCode = "Enter the 6-digit code from your email.";
      }
      if (values.password.length < 8 || values.password.length > 128) {
        errors.password = "Use between 8 and 128 characters.";
      }
      if (values.confirmPassword !== values.password) {
        errors.confirmPassword = "Passwords do not match.";
      }
    }
    return errors;
  }

  if (values.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }

  if (values.mode === "signup") {
    if (values.fullName.trim().length < 2) {
      errors.fullName = "Enter your full name.";
    }
    if (!usernamePattern.test(values.username.trim())) {
      errors.username = "Use 3–20 letters, numbers, dots, or underscores.";
    }
    if (values.confirmPassword !== values.password) {
      errors.confirmPassword = "Passwords do not match.";
    }
    if (!kenyanPhonePattern.test(values.phone.replace(/\s/g, ""))) {
      errors.phone = "Enter a Kenyan mobile number, e.g. +254 712 345 678.";
    }
  }

  return errors;
}

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "The authentication request could not be completed. Please try again.";
  }

  const message = error.message.toLowerCase();
  if (message.includes("unsupported provider") || message.includes("provider is not enabled")) {
    return "Google sign-in is disabled for this Supabase project. Enable Google in Authentication → Sign In / Providers and configure its Google OAuth client ID and secret.";
  }
  if (message.includes("invalid login credentials")) {
    return "Email or password is incorrect. If you have not created an account, choose Create account. If you are sure the password is right, confirm your email first or use Forgot password.";
  }
  if (message.includes("email not confirmed")) {
    return "This account's email is not confirmed yet. Resend the confirmation email below, then check your inbox and spam folder.";
  }

  return error.message;
}

async function readEmailApiResponse(
  response: Response,
): Promise<{ message?: string; error?: string }> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      response.ok
        ? "The email service returned an unexpected response."
        : "The email service could not be reached. Please try again later.",
    );
  }
  return (await response.json()) as { message?: string; error?: string };
}

function AuthModal({
  initialMode,
  onAuthClientChanged,
  onClose,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryStage, setRecoveryStage] = useState<"request" | "reset">("request");
  const [phone, setPhone] = useState("+254");
  const [rememberMe, setRememberMe] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [requestError, setRequestError] = useState("");
  const [notice, setNotice] = useState("");
  const [emailConfirmationPending, setEmailConfirmationPending] = useState(false);
  const [googleProviderEnabled, setGoogleProviderEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const configured = isSupabaseConfigured();
  const appRedirectUrl = new URL(
    import.meta.env.BASE_URL,
    window.location.origin,
  ).toString();
  const projectUrl = import.meta.env.VITE_SUPABASE_URL;
  const googleCallbackUrl = projectUrl
    ? `${projectUrl.replace(/\/+$/, "")}/auth/v1/callback`
    : "";

  useEffect(() => {
    const projectUrl = import.meta.env.VITE_SUPABASE_URL;
    const publishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!projectUrl || !publishableKey) {
      setGoogleProviderEnabled(false);
      return;
    }

    const controller = new AbortController();
    const settingsUrl = new URL(
      "auth/v1/settings",
      projectUrl.endsWith("/") ? projectUrl : `${projectUrl}/`,
    );
    void fetch(settingsUrl, {
      headers: { apikey: publishableKey },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Supabase auth settings returned ${response.status}.`);
        }
        const settings = (await response.json()) as {
          external?: { google?: unknown };
        };
        setGoogleProviderEnabled(settings.external?.google === true);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn("Could not check the Supabase Google provider setting.", error);
          setGoogleProviderEnabled(null);
        }
      });

    return () => controller.abort();
  }, []);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setErrors({});
    setRequestError("");
    setNotice("");
    setEmailConfirmationPending(false);
    if (nextMode === "recovery") {
      setRecoveryStage("request");
      setRecoveryCode("");
      setPassword("");
      setConfirmPassword("");
    }
  }

  async function handleRecoveryRequest() {
    setRequestError("");
    setNotice("");

    const formErrors = validateForm({
      mode: "recovery",
      fullName,
      username,
      email,
      password,
      confirmPassword,
      phone,
      recoveryCode,
      recoveryStage: "request",
    });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const result = await readEmailApiResponse(response);
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to request a recovery code.");
      }

      setRecoveryStage("reset");
      setRecoveryCode("");
      setNotice(result.message ?? "If an account exists, a recovery code has been sent.");
    } catch (error) {
      setRequestError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError("");
    setNotice("");
    setEmailConfirmationPending(false);

    if (mode === "recovery" && recoveryStage === "request") {
      await handleRecoveryRequest();
      return;
    }

    const formErrors = validateForm({
      mode,
      fullName,
      username,
      email,
      password,
      confirmPassword,
      phone,
      recoveryCode,
      recoveryStage,
    });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      return;
    }

    if (mode === "recovery") {
      setBusy(true);
      try {
        const response = await fetch("/api/auth/recovery/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            code: recoveryCode,
            password,
          }),
        });
        const result = await readEmailApiResponse(response);
        if (!response.ok) {
          throw new Error(result.error ?? "Unable to reset your password.");
        }

        setMode("signin");
        setRecoveryStage("request");
        setRecoveryCode("");
        setPassword("");
        setConfirmPassword("");
        setErrors({});
        setNotice(result.message ?? "Password updated. You can now sign in.");
      } catch (error) {
        setRequestError(getErrorMessage(error));
      } finally {
        setBusy(false);
      }
      return;
    }

    const client = getSupabaseClient(rememberMe);
    if (!client) {
      setRequestError(
        "Supabase is not configured. Copy .env.example to .env.local and add your project URL and anon key.",
      );
      return;
    }

    setBusy(true);
    try {
      saveRememberSession(rememberMe);

      if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: appRedirectUrl,
            data: {
              full_name: fullName.trim(),
              username: username.trim().toLowerCase(),
              phone_number: phone.replace(/\s/g, ""),
              welcome_email_pending: true,
            },
          },
        });
        if (error) {
          throw error;
        }

        if (data.session) {
          onAuthClientChanged(client);
          onClose();
        } else {
          onAuthClientChanged(client);
          setNotice("Check your inbox to confirm your email and finish creating your account.");
        }
        return;
      }

      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        throw error;
      }

      onAuthClientChanged(client);
      onClose();
    } catch (error) {
      setEmailConfirmationPending(
        mode === "signin" &&
          error instanceof Error &&
          error.message.toLowerCase().includes("email not confirmed"),
      );
      setRequestError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmationEmail() {
    const client = getSupabaseClient(rememberMe);
    if (!client) {
      setRequestError("Supabase is not configured. Add your project URL and publishable key to .env.local.");
      return;
    }

    setBusy(true);
    setRequestError("");
    setNotice("");
    try {
      const { error } = await client.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: appRedirectUrl },
      });
      if (error) {
        throw error;
      }
      setNotice("A new confirmation link was sent. Open it on this device while Tweak is running.");
      setEmailConfirmationPending(false);
    } catch (error) {
      setRequestError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setRequestError("");
    setNotice("");

    const client = getSupabaseClient(rememberMe);
    if (!client) {
      setRequestError(
        "Supabase is not configured. Copy .env.example to .env.local and add your project URL and anon key.",
      );
      return;
    }

    setBusy(true);
    try {
      saveRememberSession(rememberMe);
      onAuthClientChanged(client);
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: appRedirectUrl },
      });
      if (error) {
        throw error;
      }
    } catch (error) {
      setRequestError(getErrorMessage(error));
      setBusy(false);
    }
  }

  return (
    <div
      className="auth-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <button
          className="auth-close"
          type="button"
          aria-label="Close sign-in dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        <div className="auth-brand">
          <span className="auth-brand-icon"><Headphones size={20} /></span>
          <span>tweak<span className="brand-period">.</span></span>
        </div>
        <p className="eyebrow auth-eyebrow">YOUR SOUND, YOUR WAY</p>
        <h2 id="auth-title">
          {mode === "signup"
            ? "Make it yours."
            : mode === "recovery"
              ? "Reset your password."
              : "Welcome back."}
        </h2>
        <p className="auth-intro">
          {mode === "signup"
            ? "Create your account and bring your listening into focus."
            : mode === "recovery"
              ? "We’ll email you a secure, short-lived recovery code."
              : "Sign in to pick up right where the music left you."}
        </p>

        {mode !== "recovery" && (
          <>
            <div className="auth-tabs" role="tablist" aria-label="Authentication">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={mode === "signin" ? "active" : ""}
                onClick={() => changeMode("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={mode === "signup" ? "active" : ""}
                onClick={() => changeMode("signup")}
              >
                Create account
              </button>
            </div>

            <button
              className="google-button"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={busy || googleProviderEnabled === false}
              title={
                googleProviderEnabled === false
                  ? "Enable Google in Supabase Authentication settings to use this option."
                  : undefined
              }
            >
              <span className="google-g" aria-hidden="true">G</span>
              {googleProviderEnabled === false
                ? "Google sign-in needs setup"
                : "Continue with Google"}
              <ArrowRight size={15} />
            </button>
            {googleProviderEnabled === false && configured && (
              <p className="auth-setup-note">
                Google is disabled in this Supabase project. Enable it in Authentication → Sign In / Providers, add your Google OAuth client ID and secret, and add this callback URL in Google Cloud: <code>{googleCallbackUrl}</code>. Allow your local app URL under Supabase Authentication → URL Configuration.
              </p>
            )}
            <div className="auth-divider"><span>or with email</span></div>
          </>
        )}

        {!configured && mode !== "recovery" && (
          <p className="auth-setup-note">
            Add your Supabase project settings to enable live authentication.
          </p>
        )}

        {mode === "recovery" && (
          <button
            className="auth-back-link"
            type="button"
            onClick={() => changeMode("signin")}
          >
            Back to sign in
          </button>
        )}

        {mode === "signin" && (
          <button
            className="auth-forgot-link"
            type="button"
            onClick={() => changeMode("recovery")}
          >
            Forgot password?
          </button>
        )}

        {mode === "recovery" ? (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <label className="auth-field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "recovery-email-error" : undefined}
                placeholder="you@example.com"
              />
              {errors.email && (
                <small id="recovery-email-error" className="field-error">{errors.email}</small>
              )}
            </label>

            {recoveryStage === "reset" && (
              <>
                <label className="auth-field">
                  <span>6-digit recovery code</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value)}
                    aria-invalid={Boolean(errors.recoveryCode)}
                    aria-describedby={errors.recoveryCode ? "recovery-code-error" : undefined}
                    placeholder="000000"
                  />
                  {errors.recoveryCode && (
                    <small id="recovery-code-error" className="field-error">{errors.recoveryCode}</small>
                  )}
                </label>
                <div className="auth-field-grid">
                  <label className="auth-field">
                    <span>New password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-invalid={Boolean(errors.password)}
                      aria-describedby={errors.password ? "recovery-password-error" : undefined}
                      placeholder="At least 8 characters"
                    />
                    {errors.password && (
                      <small id="recovery-password-error" className="field-error">{errors.password}</small>
                    )}
                  </label>
                  <label className="auth-field">
                    <span>Confirm password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      aria-invalid={Boolean(errors.confirmPassword)}
                      aria-describedby={errors.confirmPassword ? "recovery-confirm-error" : undefined}
                      placeholder="Repeat password"
                    />
                    {errors.confirmPassword && (
                      <small id="recovery-confirm-error" className="field-error">{errors.confirmPassword}</small>
                    )}
                  </label>
                </div>
                <button
                  className="auth-resend-link"
                  type="button"
                  onClick={handleRecoveryRequest}
                  disabled={busy}
                >
                  Send another code
                </button>
              </>
            )}

            {requestError && <p className="auth-message error-message" role="alert">{requestError}</p>}
            {emailConfirmationPending && (
              <button
                className="auth-resend-link"
                type="button"
                onClick={() => void resendConfirmationEmail()}
                disabled={busy || !emailPattern.test(email.trim())}
              >
                Resend confirmation email
              </button>
            )}
            {notice && <p className="auth-message success-message" role="status">{notice}</p>}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy
                ? "Please wait..."
                : recoveryStage === "request"
                  ? "Send recovery code"
                  : "Reset password"}
              {!busy && <ArrowRight size={15} />}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {mode === "signup" && (
              <div className="auth-field-grid">
                <label className="auth-field">
                  <span>Full name</span>
                  <input
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    aria-invalid={Boolean(errors.fullName)}
                    aria-describedby={errors.fullName ? "full-name-error" : undefined}
                    placeholder="Your name"
                  />
                  {errors.fullName && (
                    <small id="full-name-error" className="field-error">
                      {errors.fullName}
                    </small>
                  )}
                </label>
                <label className="auth-field">
                  <span>Username</span>
                  <input
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    aria-invalid={Boolean(errors.username)}
                    aria-describedby={errors.username ? "username-error" : undefined}
                    placeholder="yourname"
                  />
                  {errors.username && (
                    <small id="username-error" className="field-error">
                      {errors.username}
                    </small>
                  )}
                </label>
              </div>
            )}

            <label className="auth-field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "email-error" : undefined}
                placeholder="you@example.com"
              />
              {errors.email && (
                <small id="email-error" className="field-error">{errors.email}</small>
              )}
            </label>

            {mode === "signup" && (
              <label className="auth-field">
                <span>Kenyan phone number</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                  placeholder="+254 712 345 678"
                />
                {errors.phone && (
                  <small id="phone-error" className="field-error">{errors.phone}</small>
                )}
              </label>
            )}

            <div className={mode === "signup" ? "auth-field-grid" : ""}>
              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "password-error" : undefined}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                />
                {errors.password && (
                  <small id="password-error" className="field-error">
                    {errors.password}
                  </small>
                )}
              </label>
              {mode === "signup" && (
                <label className="auth-field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    aria-invalid={Boolean(errors.confirmPassword)}
                    aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
                    placeholder="Repeat password"
                  />
                  {errors.confirmPassword && (
                    <small id="confirm-password-error" className="field-error">
                      {errors.confirmPassword}
                    </small>
                  )}
                </label>
              )}
            </div>

            <label className="remember-option">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              <span>Remember me on this device</span>
            </label>

            {requestError && <p className="auth-message error-message" role="alert">{requestError}</p>}
            {emailConfirmationPending && (
              <button
                className="auth-resend-link"
                type="button"
                onClick={() => void resendConfirmationEmail()}
                disabled={busy || !emailPattern.test(email.trim())}
              >
                Resend confirmation email
              </button>
            )}
            {notice && <p className="auth-message success-message" role="status">{notice}</p>}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
              {!busy && <ArrowRight size={15} />}
            </button>
          </form>
        )}

        <p className="auth-terms">
          By continuing, you agree to keep your listening experience yours.
        </p>
      </section>
    </div>
  );
}

export default AuthModal;
