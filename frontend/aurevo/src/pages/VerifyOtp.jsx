import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import api from "../api/axios";
import AuthLayout from "../Components/AuthLayout";
import Icon from "../Components/Icon";
import OtpInput from "../Components/OtpInput";
import { parseApiError } from "../utils/errors";

// keep these in sync with OTP_RESEND_SECONDS and OTP_EXPIRY_MINUTES on the server
const RESEND_SECONDS = 45;
const EXPIRY_SECONDS = 120;

const clock = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

/** Used for both flows: purpose "signup" (verify email) and "reset" (forgot password). */
export default function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { email, purpose } = location.state || {};

  const [code, setCode] = useState("");
  const [formError, setFormError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [expiresIn, setExpiresIn] = useState(EXPIRY_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
      setExpiresIn((e) => Math.max(0, e - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // opened directly (or after a refresh): nothing to verify
  if (!email || !["signup", "reset"].includes(purpose)) {
    return <Navigate to={purpose === "reset" ? "/forgot-password" : "/login"} replace />;
  }

  const isSignup = purpose === "signup";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setFormError("");
    setInfo("");
    setSubmitting(true);
    try {
      await api.post("/auth/verify-otp/", { email, otp: code, purpose });
      if (isSignup) {
        navigate("/login", { replace: true, state: { email, message: "Email verified. You can log in now." } });
      } else {
        navigate("/reset-password", { replace: true, state: { email, otp: code } });
      }
    } catch (err) {
      setFormError(parseApiError(err).form);
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setFormError("");
    setInfo("");
    setResending(true);
    try {
      await api.post("/auth/resend-otp/", { email, purpose });
      setInfo("A new code is on its way.");
      setCode("");
      setCooldown(RESEND_SECONDS);
      setExpiresIn(EXPIRY_SECONDS);
    } catch (err) {
      setFormError(parseApiError(err).form);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title={isSignup ? "Verify your email" : "Verify OTP"}
      subtitle="We sent a 6-digit code to your email"
      icon="shield-check"
      align="left"
      image="/images/otp.jpg"
      headline={<>Elevate Your <span className="accent">Style</span>.</>}
      copy="Join the circle of shoppers who dress with intent. One quick check and you're in."
      backTo={isSignup ? { to: "/signup", label: "Back to sign up" } : { to: "/login", label: "Back to login" }}
      below="Your code is private. Never share it with anyone."
    >
      <p className="otp-email">{email}</p>
      <form onSubmit={handleSubmit}>
        {info && <div className="alert success" role="status">{info}</div>}
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <OtpInput value={code} onChange={setCode} disabled={submitting} hasError={Boolean(formError)} />
        <button className="btn primary" type="submit" disabled={submitting || code.length !== 6}>
          {submitting ? "Verifying..." : <>Verify &amp; Proceed <Icon name="arrow-right" size={16} /></>}
        </button>
      </form>

      <div className="otp-meta">
        <span>
          Didn't receive the code?{" "}
          {cooldown > 0 ? (
            <span className="muted">Resend in {cooldown}s</span>
          ) : (
            <button type="button" className="link-btn" onClick={handleResend} disabled={resending}>
              {resending ? "Sending..." : "Resend"}
            </button>
          )}
        </span>
        <span className={`timer-pill${expiresIn === 0 ? " expired" : ""}`}>
          <Icon name="clock" size={13} />
          {expiresIn > 0 ? clock(expiresIn) : "Expired"}
        </span>
      </div>
    </AuthLayout>
  );
}