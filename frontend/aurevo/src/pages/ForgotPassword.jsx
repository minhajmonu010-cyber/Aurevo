import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios";
import AuthLayout from "../Components/AuthLayout";
import Field from "../Components/Field";
import Icon from "../Components/Icon";
import { isEmail } from "../utils/validators";
import { parseApiError } from "../utils/errors";
import { COPYRIGHT_YEAR } from "../utils/constants";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!isEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setSubmitting(true);
    const clean = email.trim().toLowerCase();
    try {
      await api.post("/auth/forgot-password/", { email: clean });
      navigate("/verify-otp", { state: { email: clean, purpose: "reset" } });
    } catch (err) {
      setFormError(parseApiError(err).form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Forgot password?"
      subtitle="Enter your email address and we'll send you a code to reset your account."
      icon="history"
      serif
      image="/images/forgot.jpg"
      headline="Elevate your style, find your fit."
      copy="Old money shirts, free style streetwear and retro jerseys, all in one place."
      copyAt="middle"
      joined
      below={`© ${COPYRIGHT_YEAR} Aurevo. All rights reserved.`}
      footer={<Link to="/login" className="back-link"><Icon name="arrow-left" size={14} /> Back to Login</Link>}
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field
          label="Email Address"
          name="email"
          type="email"
          icon="mail"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (isEmail(e.target.value)) setError("");
          }}
          error={error}
          placeholder="name@company.com"
          autoComplete="email"
        />
        <button className="btn primary" type="submit" disabled={submitting}>
          {submitting ? "Sending code..." : <>Send Code <Icon name="arrow-right" size={16} /></>}
        </button>
      </form>
    </AuthLayout>
  );
}