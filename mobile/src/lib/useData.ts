// Tiny data hook (027): loads on focus, optional polling, pull-to-refresh, keeps the last good data in memory so
// screens stay useful offline (the offline banner says the data is from earlier). No extra dependency.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { ApiError, type ApiClient } from './api-core';

import { cache } from './cache';

export function useData<T>(key: string | null, load: (api: ApiClient) => Promise<T>, { interval = 0 } = {}) {
  const { api } = useAuth();
  const [data, setData] = useState<T | undefined>(() => (key ? (cache.get(key) as T | undefined) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  useLayoutEffect(() => { loadRef.current = load; });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = useCallback(async (manual = false) => {
    if (!key || !api) return;
    if (manual) setRefreshing(true);
    try {
      const out = await loadRef.current(api);
      cache.set(key, out);
      if (!alive.current) return;
      setData(out); setError(null); setStale(false);
    } catch (e) {
      if (!alive.current) return;
      const err = e as ApiError;
      if (err.status === 0 && cache.has(key)) setStale(true); // keep showing the last data
      else setError(err.message);
    } finally { if (alive.current && manual) setRefreshing(false); }
  }, [api, key]);

  useFocusEffect(useCallback(() => {
    run();
    if (!interval) return undefined;
    const id = setInterval(() => run(), interval);
    return () => clearInterval(id);
  }, [run, interval]));

  return { data, error, stale, refreshing, refresh: () => run(true), reload: () => run(), setData };
}
