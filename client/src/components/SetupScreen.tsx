import { useState } from 'react';

interface SetupScreenProps {
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [plexUrl, setPlexUrl] = useState('http://');
  const [plexToken, setPlexToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plexUrl: plexUrl.trim(),
          plexToken: plexToken.trim(),
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || 'Connection failed');
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-logo">
          <span className="setup-star">✦</span>
        </div>
        <h1 className="setup-title">Plex Galaxy</h1>
        <p className="setup-subtitle">
          Connect your Plex server to explore your movie library as a galaxy of stars.
        </p>

        <form onSubmit={handleSubmit} className="setup-form">
          <div className="field">
            <label htmlFor="plexUrl">Plex Server URL</label>
            <input
              id="plexUrl"
              type="url"
              value={plexUrl}
              onChange={e => setPlexUrl(e.target.value)}
              placeholder="http://192.168.1.x:32400"
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <span className="field-hint">
              Usually <code>http://&lt;your-NAS-IP&gt;:32400</code>
            </span>
          </div>

          <div className="field">
            <label htmlFor="plexToken">Plex Token</label>
            <input
              id="plexToken"
              type="password"
              value={plexToken}
              onChange={e => setPlexToken(e.target.value)}
              placeholder="xxxxxxxxxxxxxxxxxxxx"
              required
              autoComplete="off"
            />
            <span className="field-hint">
              In Plex Web: open any movie → ··· → Get Info → View XML.
              The token is in the URL as <code>X-Plex-Token=…</code>
            </span>
          </div>

          {error && <p className="setup-error">{error}</p>}

          <button
            type="submit"
            className="setup-btn"
            disabled={busy || !plexUrl || !plexToken}
          >
            {busy ? 'Connecting…' : 'Connect to Plex'}
          </button>
        </form>
      </div>
    </div>
  );
}
