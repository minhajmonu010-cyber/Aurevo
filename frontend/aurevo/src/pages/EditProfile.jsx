import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios";
import AccountLayout from "../Components/AccountLayout";
import Avatar from "../Components/Avatar";
import Field from "../Components/Field";
import Icon from "../Components/Icon";
import { useAuth } from "../context/authState";
import { parseApiError } from "../utils/errors";

const MAX_BYTES = 2 * 1024 * 1024; // same limit as the server
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export default function EditProfile() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone || "");
  const [file, setFile] = useState(null); // a new picture chosen but not saved yet
  const [preview, setPreview] = useState(null);
  const [removePicture, setRemovePicture] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // free the temporary preview address when it is replaced or the page closes
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  // an error disappears as soon as the person starts fixing that box
  const clearError = (key) => setErrors((prev) => ({ ...prev, [key]: undefined }));

  const updateName = (event) => {
    const value = event.target.value;
    setName(value);
    if (value.trim().length >= 2) clearError("full_name");
    setFormError("");
  };

  const updatePhone = (event) => {
    const value = event.target.value;
    const cleaned = value.replace(/[\s\-()]/g, "");
    setPhone(value);
    if (!cleaned || PHONE_PATTERN.test(cleaned)) clearError("phone");
    setFormError("");
  };

  const choosePicture = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again later
    if (!picked) return;
    if (!TYPES.includes(picked.type)) return setErrors((prev) => ({ ...prev, profile_image: "Use a JPG, PNG or WebP picture." }));
    if (picked.size > MAX_BYTES) return setErrors((prev) => ({ ...prev, profile_image: "The picture must be 2 MB or smaller." }));
    setErrors((prev) => ({ ...prev, profile_image: undefined }));
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
    setRemovePicture(false);
  };

  const dropPicture = () => {
    setFile(null);
    setPreview(null);
    setRemovePicture(true);
    clearError("profile_image");
    setFormError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");

    const next = {};
    if (name.trim().length < 2) next.full_name = "Enter your name (at least 2 characters).";
    const cleanedPhone = phone.replace(/[\s\-()]/g, "");
    if (cleanedPhone && !PHONE_PATTERN.test(cleanedPhone)) next.phone = "Enter a valid phone number (7 to 15 digits).";
    setErrors(next);
    if (Object.keys(next).length) return;

    const body = new FormData(); // multipart, because a picture may be inside
    body.append("full_name", name.trim());
    body.append("phone", cleanedPhone);
    if (file) body.append("profile_image", file);
    if (removePicture) body.append("remove_profile_image", "true");

    setSaving(true);
    try {
      const { data } = await api.patch("/auth/me/", body);
      updateUser(data);
      navigate("/profile", { replace: true, state: { message: "Profile updated." } });
    } catch (err) {
      const parsed = parseApiError(err);
      setErrors(parsed.fields);
      setFormError(parsed.form);
      setSaving(false);
    }
  };

  // what the avatar shows: the new picture, nothing (after Remove), or the saved one
  const shown = preview ?? (removePicture ? null : undefined);
  const hasPicture = Boolean(preview) || (!removePicture && Boolean(user.profile_image));

  return (
    <AccountLayout>
      <form className="edit-card" onSubmit={handleSubmit} noValidate>
        <div className="edit-head">
          <div>
            <h1 className="edit-title">Edit Profile</h1>
            <p className="edit-sub">Update your account details</p>
          </div>
          <div className="edit-buttons">
            <Link to="/profile" className="btn-ghost">
              Cancel
            </Link>
            <button type="submit" className="btn-solid" disabled={saving}>
              <Icon name="save" size={16} /> {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {formError && (
          <div className="alert error" role="alert">
            {formError}
          </div>
        )}

        <div className="photo-row">
          <Avatar user={user} size={96} glow src={shown} />
          <div>
            <label className="photo-btn">
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={choosePicture} />
              <Icon name="camera" size={16} /> Change photo
            </label>
            {hasPicture && (
              <button type="button" className="photo-remove" onClick={dropPicture}>
                <Icon name="x" size={14} /> Remove
              </button>
            )}
            <p className="field-hint">JPG, PNG or WebP, up to 2 MB.</p>
            {errors.profile_image && (
              <p className="field-error" role="alert">
                {errors.profile_image}
              </p>
            )}
          </div>
        </div>

        <div className="edit-grid">
          <Field label="Full Name" name="full_name" icon="user" value={name} onChange={updateName} error={errors.full_name} autoComplete="name" />
          <Field label="Phone" name="phone" type="tel" icon="phone" value={phone} onChange={updatePhone} error={errors.phone} placeholder="Enter phone number" autoComplete="tel" />
          <div className="col-wide">
            <Field label="Email Address" name="email" type="email" icon="mail" value={user.email} onChange={() => {}} disabled hint="Your email is your login, so it can't be changed here." />
          </div>
        </div>
      </form>
    </AccountLayout>
  );
}