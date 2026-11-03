import { useRef } from "react";

const LENGTH = 6;

/** Six boxes that behave like one input: typing, backspace, arrows and paste all work. */
export default function OtpInput({ value, onChange, disabled, hasError }) {
  const refs = useRef([]);
  const focusBox = (i) => refs.current[Math.max(0, Math.min(i, LENGTH - 1))]?.focus();

  const handleChange = (i, e) => {
    const typed = e.target.value.replace(/\D/g, "");
    if (!typed) return;
    const at = Math.min(i, value.length); // never leave gaps
    const next = (value.slice(0, at) + typed + value.slice(at + typed.length)).slice(0, LENGTH);
    onChange(next);
    focusBox(at + typed.length);
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (value[i]) {
        onChange(value.slice(0, i) + value.slice(i + 1));
      } else if (i > 0) {
        onChange(value.slice(0, i - 1) + value.slice(i));
        focusBox(i - 1);
      }
    } else if (e.key === "ArrowLeft") {
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      focusBox(i + 1);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    onChange(pasted);
    focusBox(pasted.length);
  };

  return (
    <div className="otp" role="group" aria-label="6-digit verification code">
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className={`otp-box${hasError ? " has-error" : ""}`}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={LENGTH}
          value={value[i] || ""}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}