import { useCallback, useEffect, useRef, useState } from "react";
import { getProducts } from "../api/catalog";

const EMPTY = { items: [], count: 0, hasMore: false, loading: true, loadingMore: false, error: null };

/** Fetch products in pages; catalog callers may request the remaining pages automatically. */
export function useProducts({ category, search, ordering = "featured", pageSize = 8, autoLoad = false, pageNumber }) {
  const [state, setState] = useState({ ...EMPTY, requestKey: null });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const page = useRef(1);
  const requestedPage = pageNumber ?? 1;
  const requestKey = JSON.stringify([category, search, ordering, pageSize, autoLoad, pageNumber, tick]);

  useEffect(() => {
    const id = ++latest.current;
    page.current = requestedPage;
    const fetchProducts = async () => {
      try {
        let response = await getProducts({ category, search, ordering, page: requestedPage, page_size: pageSize });
        if (id !== latest.current) return;
        page.current = requestedPage;
        setState({
          ...EMPTY,
          requestKey,
          items: response.results,
          count: response.count,
          hasMore: Boolean(response.next),
          loading: false,
          loadingMore: autoLoad && Boolean(response.next),
        });

        while (autoLoad && response.next) {
          response = await getProducts({
            category,
            search,
            ordering,
            page: page.current + 1,
            page_size: pageSize,
          });
          if (id !== latest.current) return;
          page.current += 1;
          const nextPageResults = response.results;
          const hasNextPage = Boolean(response.next);
          setState((current) => ({
            ...current,
            items: [...current.items, ...nextPageResults],
            hasMore: hasNextPage,
            loadingMore: hasNextPage,
          }));
        }
      } catch (error) {
        if (id === latest.current) {
          setState((current) => ({
            ...current,
            requestKey,
            loading: false,
            loadingMore: false,
            error,
          }));
        }
      }
    };
    void fetchProducts();
  }, [category, search, ordering, pageSize, autoLoad, pageNumber, requestedPage, tick, requestKey]);

  const currentState = state.requestKey === requestKey ? state : EMPTY;

  const loadMore = useCallback(() => {
    if (currentState.loading || currentState.loadingMore || !currentState.hasMore) return;
    const id = latest.current;
    setState((s) => ({ ...s, loadingMore: true }));
    getProducts({ category, search, ordering, page: page.current + 1, page_size: pageSize })
      .then((d) => {
        if (id !== latest.current) return;
        page.current += 1;
        setState((s) => ({ ...s, items: [...s.items, ...d.results], hasMore: Boolean(d.next), loadingMore: false }));
      })
      .catch(() => id === latest.current && setState((s) => ({ ...s, loadingMore: false })));
  }, [category, search, ordering, pageSize, currentState.loading, currentState.loadingMore, currentState.hasMore]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    ...currentState,
    pageCount: Math.ceil((currentState.count || (pageNumber === undefined ? 0 : state.count)) / pageSize),
    loadMore,
    reload,
  };
}