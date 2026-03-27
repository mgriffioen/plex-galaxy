import { useState, useEffect, useRef } from 'react';
import type { Movie, PlexClient } from '../types';

interface MoviePanelProps {
  movie: Movie | null;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StarRating({ value }: { value: number }) {
  const pct = Math.round((value / 10) * 100);
  return (
    <span className="star-rating" title={`${value.toFixed(1)} / 10`}>
      <span className="star-fill" style={{ width: `${pct}%` }}>★★★★★</span>
      <span className="star-empty">★★★★★</span>
    </span>
  );
}

export function MoviePanel({ movie, onClose }: MoviePanelProps) {
  const [clients, setClients] = useState<PlexClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [playStatus, setPlayStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [playError, setPlayError] = useState('');
  const [loadingClients, setLoadingClients] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset state when movie changes
  useEffect(() => {
    setPlayStatus('idle');
    setPlayError('');
    setPosterError(false);
  }, [movie?.id]);

  // Fetch clients when panel opens
  useEffect(() => {
    if (!movie) return;
    setLoadingClients(true);
    fetch('/api/clients')
      .then(r => r.json())
      .then((data: PlexClient[]) => {
        setClients(data);
        if (data.length > 0) setSelectedClient(data[0].id);
      })
      .catch(() => setClients([]))
      .finally(() => setLoadingClients(false));
  }, [movie?.id]);

  const handlePlay = async () => {
    if (!movie || !selectedClient) return;
    const client = clients.find(c => c.id === selectedClient);
    if (!client) return;

    setPlayStatus('sending');
    setPlayError('');
    try {
      const res = await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movieId: movie.id,
          clientId: client.id,
          clientAddress: client.address,
          clientPort: client.port,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || 'Playback failed');
      setPlayStatus('ok');
      setTimeout(() => setPlayStatus('idle'), 3000);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Unknown error');
      setPlayStatus('err');
    }
  };

  const visible = movie !== null;

  // Swipe-to-close on mobile: track touch start
  const touchStartY = useRef(0);
  const onPanelTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  const onPanelTouchEnd = (e: React.TouchEvent) => {
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (dy > 80) onClose(); // swipe down to close
  };

  return (
    <>
      {/* Scrim */}
      {visible && (
        <div
          className="panel-scrim"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`movie-panel ${visible ? 'visible' : ''}`}
        onTouchStart={onPanelTouchStart}
        onTouchEnd={onPanelTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-label={movie?.title ?? 'Movie details'}
      >
        {/* Drag handle (mobile) */}
        <div className="drag-handle" />

        <button className="close-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>

        {movie && (
          <div className="panel-content">
            {/* Poster */}
            <div className="poster-wrap">
              {!posterError ? (
                <img
                  key={movie.id}
                  src={`/api/poster/${movie.id}`}
                  alt={movie.title}
                  className="poster"
                  onError={() => setPosterError(true)}
                />
              ) : (
                <div className="poster-placeholder">
                  <span>{movie.title.charAt(0)}</span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="movie-info">
              <h2 className="movie-title">{movie.title}</h2>

              <div className="movie-meta">
                {movie.year && <span className="meta-chip">{movie.year}</span>}
                {movie.contentRating && (
                  <span className="meta-chip rating-chip">{movie.contentRating}</span>
                )}
                {movie.duration && (
                  <span className="meta-chip">{formatDuration(movie.duration)}</span>
                )}
              </div>

              {movie.rating != null && (
                <div className="score-row">
                  <StarRating value={movie.rating} />
                  <span className="score-text">{movie.rating.toFixed(1)}</span>
                  {movie.audienceRating != null && (
                    <span className="audience-score">
                      · {movie.audienceRating.toFixed(1)} audience
                    </span>
                  )}
                </div>
              )}

              {movie.genres.length > 0 && (
                <div className="genre-tags">
                  {movie.genres.map(g => (
                    <span key={g} className="genre-tag">{g}</span>
                  ))}
                </div>
              )}

              {movie.directors.length > 0 && (
                <div className="crew-row">
                  <span className="crew-label">Director</span>
                  <span className="crew-value">{movie.directors.join(', ')}</span>
                </div>
              )}

              {movie.cast.length > 0 && (
                <div className="crew-row">
                  <span className="crew-label">Cast</span>
                  <span className="crew-value">
                    {movie.cast.map(c => c.name).join(', ')}
                  </span>
                </div>
              )}

              {movie.studio && (
                <div className="crew-row">
                  <span className="crew-label">Studio</span>
                  <span className="crew-value">{movie.studio}</span>
                </div>
              )}

              {movie.summary && (
                <p className="summary">{movie.summary}</p>
              )}

              {/* Play on TV */}
              <div className="play-section">
                <h3 className="play-heading">Play on TV</h3>
                {loadingClients ? (
                  <p className="clients-loading">Looking for devices…</p>
                ) : clients.length === 0 ? (
                  <p className="clients-empty">
                    No Plex players found on your network.
                    <br />
                    Make sure your TV's Plex app is open.
                  </p>
                ) : (
                  <>
                    <div className="client-grid">
                      {clients.map(c => (
                        <button
                          key={c.id}
                          className={`client-btn ${selectedClient === c.id ? 'selected' : ''}`}
                          onClick={() => setSelectedClient(c.id)}
                        >
                          <span className="client-icon">{clientIcon(c.product)}</span>
                          <span className="client-name">{c.name}</span>
                          <span className="client-platform">{c.platform}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      className={`play-btn ${playStatus === 'sending' ? 'loading' : ''} ${playStatus === 'ok' ? 'success' : ''}`}
                      onClick={handlePlay}
                      disabled={!selectedClient || playStatus === 'sending'}
                    >
                      {playStatus === 'sending' && '▶ Starting…'}
                      {playStatus === 'ok' && '✓ Playing'}
                      {(playStatus === 'idle' || playStatus === 'err') && '▶ Play'}
                    </button>
                    {playStatus === 'err' && (
                      <p className="play-error">{playError}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function clientIcon(product: string): string {
  const p = product.toLowerCase();
  if (p.includes('apple')) return '📺';
  if (p.includes('android')) return '📱';
  if (p.includes('chrome')) return '🖥';
  if (p.includes('roku')) return '📺';
  if (p.includes('fire')) return '🔥';
  return '📺';
}
