import { useCallback, useEffect, useRef, useState } from "react";

/** Runs `load()` when the page opens and again whenever `deps` change. Gives { data, loading, error, reload }. */
export function useFetch(load, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current; // an older, slower answer must not replace a newer one
    setState((s) => ({ ...s, loading: true, error: null }));
    load()
      .then((data) => id === latest.current && setState({ data, loading: false, error: null }))
      .catch((error) => id === latest.current && setState({ data: null, loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}