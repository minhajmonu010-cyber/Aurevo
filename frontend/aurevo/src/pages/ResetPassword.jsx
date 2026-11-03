import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import api from "../api/axios";
import AuthLayout from "../Components/AuthLayout";
import Field from "../Components/Field";
import Icon from "../Components/Icon";
import { passwordProblem } from "../utils/validators";
import { parseApiError } from "../utils/errors";

export default function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const { email, otp } = location.state || {};

  const [form, setForm] = useState({ new_password: "", confirm_password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!email || !otp) return <Navigate to="/forgot-password" replace />;

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const next = {};
    const problem = passwordProblem(form.new_password);
    if (problem) next.new_password = problem;
    if (form.confirm_password !== form.new_password) next.confirm_password = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      await api.post("/auth/reset-password/", { email, otp, ...form });
      navigate("/login", { replace: true, state: { email, message: "Password updated. Log in with your new password." } });
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
      title="Create New Password"
      subtitle="Please enter and confirm your new password to secure your account."
      icon="lock"
      image="/images/reset.jpg"
      headline={<>Elevate Your <span className="accent">Wardrobe</span> with Style.</>}
      copy="Pick a strong password, then get back to finding your next favourite shirt."
      footer={<Link to="/login" className="back-link"><Icon name="arrow-left" size={14} /> Back to Login</Link>}
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field label="New Password" name="new_password" type="password" icon="lock" placeholder="••••••••" value={form.new_password} onChange={update} error={errors.new_password} hint="At least 8 characters." autoComplete="new-password" />
        <Field label="Confirm New Password" name="confirm_password" type="password" icon="lock" placeholder="••••••••" value={form.confirm_password} onChange={update} error={errors.confirm_password} autoComplete="new-password" />
        <button className="btn primary" type="submit" disabled={submitting}>
          {submitting ? "Saving..." : <>Reset Password <Icon name="arrow-right" size={16} /></>}
        </button>
      </form>
    </AuthLayout>
  );
}