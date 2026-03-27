import { useState, useEffect, useCallback } from 'react';
import type { Movie } from '../types';

type Status = 'checking' | 'unconfigured' | 'loading' | 'ready' | 'error';

export function useMovies() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);

  const loadMovies = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/movies');
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as Movie[];
      setMovies(data);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load movies');
      setStatus('error');
    }
  }, []);

  const checkAndLoad = useCallback(async () => {
    setStatus('checking');
    try {
      const res = await fetch('/api/status');
      const data = await res.json() as { configured: boolean };
      if (data.configured) {
        await loadMovies();
      } else {
        setStatus('unconfigured');
      }
    } catch {
      setError('Cannot reach server. Is it running?');
      setStatus('error');
    }
  }, [loadMovies]);

  useEffect(() => {
    void checkAndLoad();
  }, [checkAndLoad]);

  return { movies, status, error, reload: checkAndLoad };
}
