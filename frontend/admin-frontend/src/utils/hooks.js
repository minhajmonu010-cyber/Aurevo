import { useEffect, useRef, useState } from "react";

// The value, but only after it stopped changing for `delay` ms (so a search box does not call the server on every key).
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// A temporary address for showing a chosen File as a picture.
export function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  // Object URLs must be created and stored from an effect, not during render.
  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (!file) return undefined;
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  // oxlint-enable react/set-state-in-effect
  return file ? url : null;
}

// Calls `load` again whenever `deps` change and keeps the latest answer, the loading flag and the error.
export function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null, deps: null });
  const counter = useRef(0);
  useEffect(() => {
    const id = ++counter.current;
    load()
      .then((data) => id === counter.current && setState({ data, loading: false, error: null, deps: [...deps] }))
      .catch((error) => id === counter.current && setState({ data: null, loading: false, error, deps: [...deps] }));
    // The dependency values are supplied by each hook caller.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const hasCurrentDeps = state.deps?.length === deps.length && deps.every((value, index) => Object.is(value, state.deps[index]));
  return hasCurrentDeps ? state : { data: null, loading: true, error: null, deps: null };
}
