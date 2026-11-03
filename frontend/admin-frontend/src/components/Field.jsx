import { useId, useState } from "react";
import Icon from "./Icon";

export default function Field({
  label,
  name,
  type = "text",
  icon,
  value,
  onChange,
  error,
  hint,
  placeholder,
  autoComplete,
  disabled,
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`input-wrap${error ? " has-error" : ""}${icon ? " with-icon" : ""}`}>
        {icon && <Icon name={icon} size={16} className="field-icon" />}
        <input
          id={id}
          name={name}
          type={isPassword && show ? "text" : type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={describedBy}
        />
        {isPassword && (
          <button
            type="button"
            className="toggle-visibility"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
          >
            <Icon name={show ? "eye-off" : "eye"} size={16} />
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}