import axios, { AxiosRequestConfig } from 'axios';

export interface PlexConfig {
  plexUrl: string;
  plexToken: string;
}

export interface Movie {
  id: string;
  title: string;
  year?: number;
  summary?: string;
  rating?: number;
  audienceRating?: number;
  posterPath?: string;
  duration?: number;
  contentRating?: string;
  studio?: string;
  genres: string[];
  directors: string[];
  writers: string[];
  cast: Array<{ name: string; role: string }>;
}

export interface PlexClient {
  id: string;
  name: string;
  address: string;
  port: number;
  product: string;
  platform: string;
}

function plexHeaders(token: string) {
  return {
    'X-Plex-Token': token,
    'Accept': 'application/json',
    'X-Plex-Client-Identifier': 'plex-galaxy-app',
    'X-Plex-Product': 'Plex Galaxy',
    'X-Plex-Version': '1.0.0',
  };
}

function plexRequest(config: PlexConfig, path: string, extra?: AxiosRequestConfig) {
  return axios.get(`${config.plexUrl}${path}`, {
    headers: plexHeaders(config.plexToken),
    timeout: 15000,
    ...extra,
  });
}

function normalizeMovie(item: Record<string, unknown>): Movie {
  const genres = ((item.Genre as Array<{ tag: string }>) || []).map(g => g.tag);
  const directors = ((item.Director as Array<{ tag: string }>) || []).map(d => d.tag);
  const writers = ((item.Writer as Array<{ tag: string }>) || []).map(w => w.tag);
  const cast = ((item.Role as Array<{ tag: string; role: string }>) || [])
    .slice(0, 12)
    .map(r => ({ name: r.tag, role: r.role || '' }));

  return {
    id: String(item.ratingKey),
    title: String(item.title || ''),
    year: item.year ? Number(item.year) : undefined,
    summary: item.summary ? String(item.summary) : undefined,
    rating: item.rating ? Number(item.rating) : undefined,
    audienceRating: item.audienceRating ? Number(item.audienceRating) : undefined,
    posterPath: item.thumb ? String(item.thumb) : undefined,
    duration: item.duration ? Number(item.duration) : undefined,
    contentRating: item.contentRating ? String(item.contentRating) : undefined,
    studio: item.studio ? String(item.studio) : undefined,
    genres,
    directors,
    writers,
    cast,
  };
}

export async function testConnection(config: PlexConfig): Promise<boolean> {
  const res = await plexRequest(config, '/');
  return res.status === 200;
}

export async function getMovies(config: PlexConfig): Promise<Movie[]> {
  // List all library sections
  const sectionsRes = await plexRequest(config, '/library/sections');
  const sections: Array<Record<string, unknown>> =
    sectionsRes.data?.MediaContainer?.Directory || [];

  const movieSections = sections.filter(s => s.type === 'movie');

  const allMovies: Movie[] = [];
  for (const section of movieSections) {
    const res = await plexRequest(config, `/library/sections/${section.key}/all`, {
      params: { sort: 'titleSort' },
    });
    const items: Array<Record<string, unknown>> =
      res.data?.MediaContainer?.Metadata || [];
    allMovies.push(...items.map(normalizeMovie));
  }

  return allMovies;
}

export async function getMovieDetail(config: PlexConfig, ratingKey: string): Promise<Movie | null> {
  const res = await plexRequest(config, `/library/metadata/${ratingKey}`);
  const items: Array<Record<string, unknown>> =
    res.data?.MediaContainer?.Metadata || [];
  if (!items.length) return null;
  return normalizeMovie(items[0]);
}

export async function getClients(config: PlexConfig): Promise<PlexClient[]> {
  try {
    const res = await plexRequest(config, '/clients');
    const clients: Array<Record<string, unknown>> =
      res.data?.MediaContainer?.Server || [];
    return clients.map(c => ({
      id: String(c.machineIdentifier || c.name),
      name: String(c.name || 'Unknown'),
      address: String(c.address || ''),
      port: Number(c.port || 32433),
      product: String(c.product || ''),
      platform: String(c.platform || ''),
    }));
  } catch {
    return [];
  }
}

export async function playOnClient(
  config: PlexConfig,
  movieId: string,
  clientId: string,
  clientAddress: string,
  clientPort: number
): Promise<void> {
  const key = `/library/metadata/${movieId}`;
  const mediaKey = `/library/metadata/${movieId}`;

  await axios.get(`${config.plexUrl}/player/playback/playMedia`, {
    headers: {
      ...plexHeaders(config.plexToken),
      'X-Plex-Target-Client-Identifier': clientId,
    },
    params: {
      commandID: Date.now(),
      type: 'video',
      key,
      containerKey: mediaKey,
      machineIdentifier: clientId,
      address: clientAddress,
      port: clientPort,
      uri: `server://${clientId}/com.plexapp.plugins.library${key}`,
    },
    timeout: 10000,
  });
}

export async function proxyPoster(
  config: PlexConfig,
  path: string
): Promise<{ data: Buffer; contentType: string }> {
  const res = await axios.get(`${config.plexUrl}${path}`, {
    headers: { 'X-Plex-Token': config.plexToken },
    responseType: 'arraybuffer',
    timeout: 10000,
    params: { width: 400, height: 600, minSize: 1, upscale: 1 },
  });
  return {
    data: Buffer.from(res.data),
    contentType: String(res.headers['content-type'] || 'image/jpeg'),
  };
}
