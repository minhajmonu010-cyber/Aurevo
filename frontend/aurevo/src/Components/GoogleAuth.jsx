import { useLayoutEffect, useRef, useState } from "react";
import { useEffect } from "react";
import { useGoogleOAuth } from "@react-oauth/google";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/authState";
import { parseApiError } from "../utils/errors";

const GOOGLE_ENABLED = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
const GOOGLE_CALLBACKS_KEY = "__aurevoGoogleAuthCallbacks";

function GoogleIdentityButton({ width, onSuccess, onError }) {
  const { clientId, scriptLoadedSuccessfully } = useGoogleOAuth();
  const button = useRef(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    const container = button.current;
    if (!scriptLoadedSuccessfully || !width || !container) return;

    const googleId = window.google?.accounts?.id;
    if (!googleId) {
      onErrorRef.current();
      return;
    }

    const bridge = window[GOOGLE_CALLBACKS_KEY] || {
      clientId: null,
      callbacks: null,
    };
    window[GOOGLE_CALLBACKS_KEY] = bridge;

    const callbacks = {
      onSuccess: (response) => onSuccessRef.current(response),
      onError: () => onErrorRef.current(),
    };
    bridge.callbacks = callbacks;

    if (bridge.clientId !== clientId) {
      googleId.initialize({
        client_id: clientId,
        callback: (response) => {
          const activeCallbacks = window[GOOGLE_CALLBACKS_KEY]?.callbacks;
          if (response?.credential) activeCallbacks?.onSuccess(response);
          else activeCallbacks?.onError();
        },
      });
      bridge.clientId = clientId;
    }

    container.replaceChildren();
    googleId.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: String(width),
    });

    return () => {
      if (bridge.callbacks === callbacks) bridge.callbacks = null;
      container.replaceChildren();
    };
  }, [clientId, scriptLoadedSuccessfully, width]);

  return <div className="google-overlay" ref={button} />;
}

// Google's "G" logo
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function GoogleAuth({ redirectTo = "/" }) {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const box = useRef(null);
  const [width, setWidth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Google's button needs a pixel width (200 to 400): keep it the same size as ours
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(400, Math.max(200, Math.floor(el.offsetWidth))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleSuccess = async (response) => {
    setError("");
    setBusy(true);
    try {
      await loginWithGoogle(response.credential);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(parseApiError(err).form);
      setBusy(false);
    }
  };

  const handleGoogleError = () => {
    setError("Google sign-in was cancelled or failed. Try again.");
    setBusy(false);
  };

  const label = (
    <>
      <GoogleG />
      <span>{busy ? "Signing in..." : "Continue with Google"}</span>
    </>
  );

  return (
    <div className="google-auth">
      <div className="divider">
        <span>or continue with</span>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className={`google-wrap${busy ? " busy" : ""}`} ref={box}>
        {GOOGLE_ENABLED ? (
          <>
            <div className="google-visual" aria-hidden="true">
              {label}
            </div>
            <GoogleIdentityButton
              width={width}
              onSuccess={handleSuccess}
              onError={handleGoogleError}
            />
          </>
        ) : (
          <button
            type="button"
            className="google-visual"
            onClick={() =>
              setError("Google sign-in isn't set up yet. Add VITE_GOOGLE_CLIENT_ID to your .env file (see the README).")
            }
          >
            {label}
          </button>
        )}
      </div>
    </div>
  );
}