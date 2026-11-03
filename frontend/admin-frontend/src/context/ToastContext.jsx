import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, tone = "info") => {
    clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className={`ad-toast ${toast.tone}`} role="status">
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export const useToast = () => useContext(ToastContext);
