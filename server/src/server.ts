import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
  testConnection,
  getMovies,
  getMovieDetail,
  getClients,
  playOnClient,
  proxyPoster,
  PlexConfig,
} from './plexApi';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const CONFIG_FILE = path.join(__dirname, '../config.json');

app.use(cors());
app.use(express.json());

// ── Config management ────────────────────────────────────────────────────────

function loadConfig(): PlexConfig | null {
  if (process.env.PLEX_URL && process.env.PLEX_TOKEN) {
    return { plexUrl: process.env.PLEX_URL, plexToken: process.env.PLEX_TOKEN };
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as PlexConfig;
    } catch {
      return null;
    }
  }
  return null;
}

function requireConfig(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const cfg = loadConfig();
  if (!cfg) {
    res.status(503).json({ error: 'Plex not configured' });
    return;
  }
  (req as express.Request & { plexConfig: PlexConfig }).plexConfig = cfg;
  next();
}

// ── Status & config ──────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  const cfg = loadConfig();
  res.json({ configured: cfg !== null });
});

app.post('/api/config', async (req, res) => {
  const { plexUrl, plexToken } = req.body as { plexUrl: string; plexToken: string };
  if (!plexUrl || !plexToken) {
    res.status(400).json({ error: 'plexUrl and plexToken are required' });
    return;
  }

  const trimmedUrl = plexUrl.replace(/\/$/, '');
  const config: PlexConfig = { plexUrl: trimmedUrl, plexToken: plexToken.trim() };

  try {
    await testConnection(config);
  } catch {
    res.status(400).json({ error: 'Could not connect to Plex server. Check URL and token.' });
    return;
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  res.json({ ok: true });
});

// ── Movies ───────────────────────────────────────────────────────────────────

app.get('/api/movies', requireConfig, async (req, res) => {
  const cfg = (req as express.Request & { plexConfig: PlexConfig }).plexConfig;
  try {
    const movies = await getMovies(cfg);
    res.json(movies);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: `Failed to fetch movies: ${msg}` });
  }
});

app.get('/api/movies/:id', requireConfig, async (req, res) => {
  const cfg = (req as express.Request & { plexConfig: PlexConfig }).plexConfig;
  try {
    const movie = await getMovieDetail(cfg, req.params.id);
    if (!movie) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(movie);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: msg });
  }
});

// ── Poster proxy ─────────────────────────────────────────────────────────────

app.get('/api/poster/:id', requireConfig, async (req, res) => {
  const cfg = (req as express.Request & { plexConfig: PlexConfig }).plexConfig;
  try {
    const { data, contentType } = await proxyPoster(
      cfg,
      `/library/metadata/${req.params.id}/thumb`
    );
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(data);
  } catch {
    res.status(404).send();
  }
});

// ── Clients & playback ───────────────────────────────────────────────────────

app.get('/api/clients', requireConfig, async (req, res) => {
  const cfg = (req as express.Request & { plexConfig: PlexConfig }).plexConfig;
  try {
    const clients = await getClients(cfg);
    res.json(clients);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: msg });
  }
});

app.post('/api/play', requireConfig, async (req, res) => {
  const cfg = (req as express.Request & { plexConfig: PlexConfig }).plexConfig;
  const { movieId, clientId, clientAddress, clientPort } = req.body as {
    movieId: string;
    clientId: string;
    clientAddress: string;
    clientPort: number;
  };

  if (!movieId || !clientId) {
    res.status(400).json({ error: 'movieId and clientId are required' });
    return;
  }

  try {
    await playOnClient(cfg, movieId, clientId, clientAddress, clientPort);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: `Playback failed: ${msg}` });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Plex Galaxy server running on http://localhost:${PORT}`);
  const cfg = loadConfig();
  if (cfg) {
    console.log(`Plex configured: ${cfg.plexUrl}`);
  } else {
    console.log('Plex not configured — open the app to set up your server.');
  }
});
