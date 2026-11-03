import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios";
import AuthLayout from "../Components/AuthLayout";
import Field from "../Components/Field";
import Icon from "../Components/Icon";
import GoogleAuth from "../Components/GoogleAuth";
import { isEmail, passwordProblem } from "../utils/validators";
import { parseApiError } from "../utils/errors";
import { COPYRIGHT_YEAR } from "../utils/constants";

export default function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm_password: "" });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const validate = () => {
    const next = {};
    if (form.full_name.trim().length < 2) next.full_name = "Enter your full name.";
    if (!isEmail(form.email)) next.email = "Enter a valid email address.";
    const pwProblem = passwordProblem(form.password);
    if (pwProblem) next.password = pwProblem;
    if (form.confirm_password !== form.password) next.confirm_password = "Passwords do not match.";
    if (!accepted) next.terms = "Please accept the Terms of Service and Privacy Policy.";
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const clientErrors = validate();
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;

    setSubmitting(true);
    try {
      const email = form.email.trim().toLowerCase();
      const response = await api.post("/auth/signup/", {
        ...form,
        full_name: form.full_name.trim(),
        email,
        accepted_terms: accepted,
      });
      if (response.data.verification_required) {
        navigate("/verify-otp", { state: { email, purpose: "signup" } });
        return;
      }
      navigate("/login", {
        state: { email, message: "Account created. Sign in to continue." },
      });
    } catch (err) {
      const parsed = parseApiError(err);
      setErrors(parsed.fields);
      setFormError(parsed.form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Join hundreds of shoppers today"
      image="/images/signup.jpg"
      headline={<>Refurbish your <span className="accent">style</span>.</>}
      copy="Curated styles, insider savings, and lightning-fast checkout—your ultimate wardrobe upgrade starts here."
      below={`© ${COPYRIGHT_YEAR} Aurevo. All rights reserved.`}
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field label="Full Name" name="full_name" icon="user" value={form.full_name} onChange={update} error={errors.full_name} placeholder="John Doe" autoComplete="name" />
        <Field label="Email Address" name="email" type="email" icon="mail" value={form.email} onChange={update} error={errors.email} placeholder="name@company.com" autoComplete="email" />
        <Field label="Password" name="password" type="password" icon="lock" placeholder="••••••••" value={form.password} onChange={update} error={errors.password} hint="At least 8 characters." autoComplete="new-password" />
        <Field label="Confirm Password" name="confirm_password" type="password" icon="lock" placeholder="••••••••" value={form.confirm_password} onChange={update} error={errors.confirm_password} autoComplete="new-password" />
        <div className="terms">
          <label className="check">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>
              I agree to the{" "}
              <Link to="/terms">Terms of Service</Link> and{" "}
              <Link to="/privacy">Privacy Policy</Link>
            </span>
          </label>
          {errors.terms && <p className="field-error" role="alert">{errors.terms}</p>}
        </div>
        <button className="btn primary" type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : <>Create Account <Icon name="arrow-right" size={16} /></>}
        </button>
      </form>
      <GoogleAuth />
    </AuthLayout>
  );
}