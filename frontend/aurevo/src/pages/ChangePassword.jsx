import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { tokens } from "../api/axios";
import AuthLayout from "../Components/AuthLayout";
import Field from "../Components/Field";
import Icon from "../Components/Icon";
import { passwordProblem } from "../utils/validators";
import { parseApiError } from "../utils/errors";

const EMPTY = { current_password: "", new_password: "", confirm_password: "" };

export default function ChangePassword() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const next = {};
    if (!form.current_password) next.current_password = "Enter your current password.";
    const problem = passwordProblem(form.new_password);
    if (problem) next.new_password = problem;
    if (form.confirm_password !== form.new_password) next.confirm_password = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/change-password/", form);
      tokens.set(data.access, data.refresh); // other devices are signed out; this one stays in
      navigate("/", { replace: true });
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
      title="Change Password"
      image="/images/change.jpg"
      headline={<>Elevate Your <span className="accent">Wardrobe</span> with Style.</>}
      copy="Keep your account safe with a password only you know."
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field label="Current Password" name="current_password" type="password" icon="lock" placeholder="••••••••" value={form.current_password} onChange={update} error={errors.current_password} autoComplete="current-password" />
        <Field label="New Password" name="new_password" type="password" icon="lock" placeholder="••••••••" value={form.new_password} onChange={update} error={errors.new_password} hint="At least 8 characters." autoComplete="new-password" />
        <Field label="Confirm New Password" name="confirm_password" type="password" icon="lock" placeholder="••••••••" value={form.confirm_password} onChange={update} error={errors.confirm_password} autoComplete="new-password" />
        <div className="btn-row">
          <button className="btn primary" type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save Changes"}
          </button>
          <Link className="btn secondary" to="/">
            <Icon name="arrow-left" size={14} /> Back to Home
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}