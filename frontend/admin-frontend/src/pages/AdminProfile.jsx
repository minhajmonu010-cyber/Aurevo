import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getAdminProfile, updateAdminProfile } from "../api/admin";
import Icon from "../components/Icon";
import { Pill, Toggle } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { initials } from "../utils/format";

const EMPTY_FORM = { first_name: "", last_name: "", phone: "" };

function getErrorMessage(error) {
  const data = error.response?.data;
  if (data?.detail) return data.detail;
  if (data && typeof data === "object") {
    const message = Object.values(data).flat()[0];
    if (message) return message;
  }
  return "Unable to save profile changes. Please try again.";
}

function formatJoinDate(value) {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export default function AdminProfile() {
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useOutletContext();
  const [form, setForm] = useState(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState(EMPTY_FORM);
  const [profile, setProfile] = useState(user || {});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const data = await getAdminProfile();
        const values = {
          first_name: data.first_name || "",
          last_name: data.last_name || "",
          phone: data.phone || "",
        };
        if (active) {
          setProfile(data);
          setForm(values);
          setSavedForm(values);
          updateUser(data);
        }
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, [updateUser]);

  const dirty = form.first_name !== savedForm.first_name
    || form.last_name !== savedForm.last_name
    || form.phone !== savedForm.phone;
  const fullName = [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(" ") || profile.email || "Administrator";
  const completion = useMemo(() => {
    const completed = Number(Boolean(profile.email)) + Number(Boolean(form.first_name.trim() && form.last_name.trim())) + Number(Boolean(form.phone.trim()));
    return Math.round((completed / 3) * 100);
  }, [form.first_name, form.last_name, form.phone, profile.email]);

  function handleChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setMessage("");
    setError("");
  }

  function discardChanges() {
    setForm(savedForm);
    setMessage("");
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const data = await updateAdminProfile({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
      });
      const values = {
        first_name: data.first_name || "",
        last_name: data.last_name || "",
        phone: data.phone || "",
      };
      setProfile(data);
      setForm(values);
      setSavedForm(values);
      updateUser(data);
      setMessage("Your profile has been updated.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="ad-card ad-card-pad admin-profile-loading">Loading your profile...</div>;
  }

  return (
    <>
      <div className="ad-crumbs">Account / <b>Administrator profile</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Your profile</h1>
          <p className="ad-sub">Manage your admin details and account preferences.</p>
        </div>
        {dirty && <Pill tone="warn">Unsaved changes</Pill>}
      </div>

      <section className="admin-profile-hero">
        <div className="admin-profile-identity">
          <span className="admin-profile-avatar">{initials(fullName)}</span>
          <div className="admin-profile-identity-copy">
            <span className="admin-profile-kicker">Administrator account</span>
            <h2>{fullName}</h2>
            <p>{profile.email}</p>
          </div>
        </div>
        <div className="admin-profile-role">
          <Pill tone={profile.is_staff ? "ok" : "bad"} icon={profile.is_staff ? "shield-check" : "alert-triangle"}>
            {profile.is_staff ? "Admin access" : "Access unavailable"}
          </Pill>
          <span>{profile.is_verified ? "Verified account" : "Verification pending"}</span>
        </div>
      </section>

      {error && <div className="ad-alert" role="alert">{error}</div>}
      {message && <div className="ad-alert ok" role="status">{message}</div>}

      <div className="admin-profile-layout">
        <section className="ad-card ad-card-pad admin-profile-card">
          <div className="ad-card-head">
            <div>
              <span className="ad-eyebrow">Personal information</span>
              <h3>Edit profile</h3>
            </div>
            <span className="admin-profile-card-icon"><Icon name="user" size={17} /></span>
          </div>
          <form className="admin-profile-form" onSubmit={handleSubmit}>
            <div className="admin-profile-name-fields">
              <label className="ad-field">
                <span className="ad-label">First name</span>
                <input className="ad-input" name="first_name" value={form.first_name} onChange={handleChange} maxLength={50} autoComplete="given-name" required />
              </label>
              <label className="ad-field">
                <span className="ad-label">Last name</span>
                <input className="ad-input" name="last_name" value={form.last_name} onChange={handleChange} maxLength={50} autoComplete="family-name" />
              </label>
            </div>
            <label className="ad-field">
              <span className="ad-label">Email address <span className="ad-muted">· managed by account owner</span></span>
              <span className="admin-profile-input-with-icon">
                <Icon name="mail" size={16} />
                <input className="ad-input" type="email" value={profile.email || ""} readOnly />
                <Icon name="shield-check" size={15} />
              </span>
            </label>
            <label className="ad-field">
              <span className="ad-label">Phone number <span className="ad-muted">· optional</span></span>
              <span className="admin-profile-input-with-icon">
                <Icon name="phone" size={16} />
                <input className="ad-input" type="tel" name="phone" value={form.phone} onChange={handleChange} maxLength={20} autoComplete="tel" placeholder="Add a contact number" />
              </span>
            </label>
            <div className="admin-profile-actions">
              {dirty && <button className="ad-btn ghost" type="button" onClick={discardChanges} disabled={saving}>Discard</button>}
              <button className="ad-btn primary" type="submit" disabled={saving || !dirty}>
                <Icon name="check" size={15} /> {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </section>

        <aside className="admin-profile-aside">
          <section className="ad-card ad-card-pad admin-profile-appearance">
            <div className="ad-card-head">
              <div>
                <span className="ad-eyebrow">Personalize</span>
                <h3>Appearance</h3>
              </div>
              <span className="admin-profile-card-icon"><Icon name="sun" size={17} /></span>
            </div>
            <div className="admin-profile-theme-row">
              <span className="admin-profile-theme-icon">
                <Icon name={theme === "light" ? "sun" : "moon"} size={17} />
              </span>
              <div className="admin-profile-theme-copy">
                <b>{theme === "light" ? "Light theme" : "Dark theme"}</b>
                <span>{theme === "light" ? "A bright, clear workspace" : "A comfortable, low-light workspace"}</span>
              </div>
              <Toggle
                checked={theme === "light"}
                onChange={(enabled) => setTheme(enabled ? "light" : "dark")}
                label="Toggle light theme"
              />
            </div>
            <p className="ad-hint">Your theme preference is saved on this device.</p>
          </section>

          <section className="ad-card ad-card-pad admin-profile-completion">
            <div className="ad-card-head">
              <div>
                <span className="ad-eyebrow">Profile health</span>
                <h3>Profile completion</h3>
              </div>
              <strong>{completion}%</strong>
            </div>
            <div className="admin-profile-progress" role="progressbar" aria-label="Profile completion" aria-valuenow={completion} aria-valuemin="0" aria-valuemax="100">
              <i style={{ width: `${completion}%` }} />
            </div>
            <p className="ad-hint">{completion === 100 ? "Your profile is complete." : "Add your name and a phone number to complete your profile."}</p>
            <ul className="admin-profile-checklist">
              <li className={profile.email ? "complete" : ""}><Icon name={profile.email ? "check" : "circle"} size={14} /> Email address</li>
              <li className={form.first_name.trim() && form.last_name.trim() ? "complete" : ""}><Icon name={form.first_name.trim() && form.last_name.trim() ? "check" : "circle"} size={14} /> Full name</li>
              <li className={form.phone.trim() ? "complete" : ""}><Icon name={form.phone.trim() ? "check" : "circle"} size={14} /> Contact number</li>
            </ul>
          </section>

          <section className="ad-card ad-card-pad admin-security-note">
            <div className="ad-card-head">
              <span className="admin-profile-security-icon"><Icon name="shield-check" size={18} /></span>
              <h3>Account security</h3>
            </div>
            <div className="admin-profile-security-row">
              <span>Administrator access</span>
              <Pill tone={profile.is_staff ? "ok" : "bad"}>{profile.is_staff ? "Active" : "Unavailable"}</Pill>
            </div>
            <div className="admin-profile-security-row">
              <span>Email verification</span>
              <Pill tone={profile.is_verified ? "ok" : "warn"}>{profile.is_verified ? "Verified" : "Pending"}</Pill>
            </div>
            <div className="admin-profile-security-row">
              <span>Account created</span>
              <b>{formatJoinDate(profile.created_at)}</b>
            </div>
            <p className="ad-hint">For password or sign-in changes, contact your system administrator.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
