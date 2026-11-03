import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import Field from "../components/Field";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { isEmail } from "../utils/validators";
import { parseApiError } from "../utils/errors";

export default function Login() {
  const [year] = useState(() => new Date().getFullYear());
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || "/";

  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const next = {};
    if (!isEmail(form.email)) next.email = "Enter a valid email address.";
    if (!form.password) next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      await login(form.email.trim().toLowerCase(), form.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const parsed = parseApiError(err);
      setErrors(parsed.fields);
      setFormError(parsed.form); // e.g. "Incorrect email or password." or "This account doesn't have admin access."
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Management Console"
      subtitle="Authorized staff only"
      icon="shield-check"
      image="/images/admin-login.jpg"
      headline={<>Run your store with <span className="accent">confidence</span>.</>}
      copy="Orders, products and customers, all in one place."
      below={`© ${year} Aurevo. All rights reserved.`}
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field label="Email Address" name="email" type="email" icon="mail" value={form.email} onChange={update} error={errors.email} placeholder="admin@company.com" autoComplete="username" />
        <Field label="Password" name="password" type="password" icon="lock" value={form.password} onChange={update} error={errors.password} placeholder="••••••••" autoComplete="current-password" />
        <button className="btn primary" type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : <>Sign In <Icon name="arrow-right" size={16} /></>}
        </button>
      </form>
      <p className="admin-note">Admin accounts are created by the site owner. There is no sign up.</p>
    </AuthLayout>
  );
}