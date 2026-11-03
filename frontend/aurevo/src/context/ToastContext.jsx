import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ToastContext = createContext(() => {});

/** A small message at the bottom of the screen, used for features that are not built yet. */
export function ToastProvider({ children }) {
  const [message, setMessage] = useState("");
  const timer = useRef(null);

  const show = useCallback((text) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 2600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export const useToast = () => useContext(ToastContext);