import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../Components/AuthLayout";
import Field from "../Components/Field";
import Icon from "../Components/Icon";
import GoogleAuth from "../Components/GoogleAuth";
import { useAuth } from "../context/authState";
import { isEmail } from "../utils/validators";
import { parseApiError } from "../utils/errors";
import { COPYRIGHT_YEAR } from "../utils/constants";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = location.state?.message;
  const requestedLocation = location.state?.from;
  const redirectTo =
    requestedLocation?.pathname?.startsWith("/") &&
    !requestedLocation.pathname.startsWith("//")
      ? `${requestedLocation.pathname}${requestedLocation.search || ""}${requestedLocation.hash || ""}`
      : "/";

  const [form, setForm] = useState({ email: location.state?.email || "", password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const update = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({ ...current, [name]: value }));
    if ((name === "email" && isEmail(value)) || (name === "password" && value)) {
      setErrors((current) => ({ ...current, [name]: undefined }));
    }
    setFormError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const next = {};
    if (!isEmail(form.email)) next.email = "Enter a valid email address.";
    if (!form.password) next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    const email = form.email.trim().toLowerCase();
    try {
      await login(email, form.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.code === "email_not_verified") {
        // the server just emailed a fresh code
        navigate("/verify-otp", { state: { email, purpose: "signup" } });
        return;
      }
      setErrors(parsed.fields);
      setFormError(parsed.form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Your Fit Starts Here"
      glow
      plainLabels
      serif
      image="/images/login.jpg"
      headline="Every thread tells your story."
      copy="Elevate your wardrobe with premium old money shirts, freestyle streetwear, and retro jerseys, all in one place."
      copyAt="middle"
      joined
      below={`© ${COPYRIGHT_YEAR} Aurevo. All rights reserved.`}
      footer={
        <>
          New to Aurevo? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {notice && <div className="alert success" role="status">{notice}</div>}
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field label="Email Address" name="email" type="email" icon="mail" value={form.email} onChange={update} error={errors.email} placeholder="name@company.com" autoComplete="email" />
        <div className="inline-link">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <Field label="Password" name="password" type="password" icon="lock" placeholder="••••••••" value={form.password} onChange={update} error={errors.password} autoComplete="current-password" />
        <button className="btn primary pill" type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : <>Sign In <Icon name="arrow-right" size={16} /></>}
        </button>
      </form>
      <GoogleAuth redirectTo={redirectTo} />
    </AuthLayout>
  );
}