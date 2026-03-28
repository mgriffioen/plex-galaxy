import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { Movie, GalaxyNode, GalaxyLink, LayoutMode } from '../types';

// ── Genre colour palette (dark ink on warm paper) ─────────────────────────────

const GENRE_COLORS: Record<string, [number, number, number]> = {
  'Action':           [15, 25, 60],
  'Adventure':        [40, 25, 10],
  'Animation':        [35, 30,  5],
  'Comedy':           [45, 15, 20],
  'Crime':            [40, 10, 10],
  'Documentary':      [10, 35, 28],
  'Drama':            [12, 35, 12],
  'Fantasy':          [30, 10, 45],
  'Horror':           [45,  5,  5],
  'Music':            [40,  8, 35],
  'Mystery':          [15, 15, 45],
  'Romance':          [45,  8, 18],
  'Science Fiction':  [ 5, 28, 45],
  'Sci-Fi':           [ 5, 28, 45],
  'Thriller':         [22,  8, 45],
  'War':              [28, 28, 10],
  'Western':          [45, 20,  5],
};
const DEFAULT_COLOR: [number, number, number] = [20, 20, 20];

function genreRgb(genres: string[]): [number, number, number] {
  for (const g of genres) { const c = GENRE_COLORS[g]; if (c) return c; }
  return DEFAULT_COLOR;
}
function rgb(r: number, g: number, b: number, a = 1) { return `rgba(${r},${g},${b},${a})`; }
function lighten([r, g, b]: [number, number, number], amt: number): [number, number, number] {
  return [
    Math.min(255, Math.round(r + (255 - r) * amt)),
    Math.min(255, Math.round(g + (255 - g) * amt)),
    Math.min(255, Math.round(b + (255 - b) * amt)),
  ];
}
function nodeRadius(movie: Movie) { return 22 + ((movie.rating ?? 5) / 10) * 8; }

// ── Mood map constants ────────────────────────────────────────────────────────

const GENRE_MOOD: Record<string, { tone: number; energy: number }> = {
  'Horror':           { tone: -1.0, energy:  0.1 },
  'Thriller':         { tone: -0.8, energy:  0.7 },
  'Crime':            { tone: -0.7, energy:  0.3 },
  'War':              { tone: -0.8, energy:  0.5 },
  'Mystery':          { tone: -0.5, energy: -0.1 },
  'Drama':            { tone: -0.2, energy: -0.5 },
  'Documentary':      { tone:  0.1, energy: -0.8 },
  'History':          { tone: -0.1, energy: -0.6 },
  'Western':          { tone: -0.3, energy:  0.3 },
  'Science Fiction':  { tone: -0.3, energy:  0.6 },
  'Sci-Fi':           { tone: -0.3, energy:  0.6 },
  'Action':           { tone:  0.0, energy:  1.0 },
  'Fantasy':          { tone:  0.2, energy:  0.4 },
  'Adventure':        { tone:  0.4, energy:  0.7 },
  'Romance':          { tone:  0.5, energy: -0.5 },
  'Music':            { tone:  0.5, energy:  0.0 },
  'Comedy':           { tone:  0.8, energy:  0.3 },
  'Animation':        { tone:  0.7, energy:  0.5 },
  'Family':           { tone:  0.9, energy:  0.2 },
};

function movieMood(movie: Movie) {
  const ms = movie.genres.map(g => GENRE_MOOD[g]).filter(Boolean);
  if (!ms.length) return { tone: 0, energy: 0 };
  return {
    tone:   ms.reduce((s, m) => s + m.tone,   0) / ms.length,
    energy: ms.reduce((s, m) => s + m.energy, 0) / ms.length,
  };
}

// ── Link builders (one per layout) ───────────────────────────────────────────

function buildCollabLinks(movies: Movie[]): GalaxyLink[] {
  const personMovies = new Map<string, string[]>();
  movies.forEach(m => {
    m.directors.forEach(d => {
      const k = `d:${d}`;
      if (!personMovies.has(k)) personMovies.set(k, []);
      personMovies.get(k)!.push(m.id);
    });
    m.cast.slice(0, 5).forEach(c => {
      const k = `c:${c.name}`;
      if (!personMovies.has(k)) personMovies.set(k, []);
      personMovies.get(k)!.push(m.id);
    });
  });

  const scores = new Map<string, number>();
  personMovies.forEach((ids, person) => {
    if (ids.length < 2 || ids.length > 12) return;
    const w = person.startsWith('d:') ? 3 : 1;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        scores.set(key, (scores.get(key) ?? 0) + w);
      }
  });

  const links: GalaxyLink[] = [];
  scores.forEach((value, key) => {
    if (value >= 3) {
      const [source, target] = key.split('|');
      links.push({ source, target, value });
    }
  });
  return links;
}

function buildTemporalLinks(movies: Movie[]): GalaxyLink[] {
  const byDir = new Map<string, Movie[]>();
  movies.forEach(m => m.directors.forEach(d => {
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(m);
  }));
  const links: GalaxyLink[] = [];
  byDir.forEach(ms => {
    if (ms.length < 2 || ms.length > 12) return;
    const sorted = [...ms].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    for (let i = 0; i < sorted.length - 1; i++)
      links.push({ source: sorted[i].id, target: sorted[i + 1].id });
  });
  return links;
}

function buildMoodLinks(movies: Movie[]): GalaxyLink[] {
  const moods = new Map(movies.map(m => [m.id, movieMood(m)]));
  const links: GalaxyLink[] = [];
  const added = new Set<string>();

  movies.forEach(m => {
    const mood = moods.get(m.id)!;
    movies
      .filter(o => o.id !== m.id)
      .map(o => ({
        id: o.id,
        dist: Math.hypot(moods.get(o.id)!.tone - mood.tone, moods.get(o.id)!.energy - mood.energy),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2)
      .forEach(({ id, dist }) => {
        if (dist < 0.35) {
          const key = m.id < id ? `${m.id}|${id}` : `${id}|${m.id}`;
          if (!added.has(key)) { added.add(key); links.push({ source: m.id, target: id }); }
        }
      });
  });
  return links;
}

// ── Layout annotation data ────────────────────────────────────────────────────

type AnnotationData =
  | { mode: 'collaborative' }
  | { mode: 'temporal'; cx: number; cy: number; rings: { r: number; label: string }[] }
  | { mode: 'mood'; cx: number; cy: number; scaleX: number; scaleY: number };

// ── Layout config builder ─────────────────────────────────────────────────────

interface LayoutConfig {
  links: GalaxyLink[];
  xForce: d3.ForceX<GalaxyNode>;
  yForce: d3.ForceY<GalaxyNode>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkDistance: number | ((l: any) => number);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkStrength: number | ((l: any) => number);
  chargeStrength: number;
  annotations: AnnotationData;
}

function buildLayout(mode: LayoutMode, movies: Movie[], w: number, h: number): LayoutConfig {
  const cx = w / 2, cy = h / 2, minDim = Math.min(w, h);

  // ── Collaborative ──────────────────────────────────────────────────────────
  if (mode === 'collaborative') {
    return {
      links: buildCollabLinks(movies),
      xForce: d3.forceX<GalaxyNode>(cx).strength(0.008),
      yForce: d3.forceY<GalaxyNode>(cy).strength(0.008),
      linkDistance: (l: GalaxyLink) => 160 / Math.max(1, l.value ?? 1),
      linkStrength: (l: GalaxyLink) => Math.min(0.85, (l.value ?? 1) * 0.22),
      chargeStrength: -450,
      annotations: { mode: 'collaborative' },
    };
  }

  // ── Temporal ───────────────────────────────────────────────────────────────
  if (mode === 'temporal') {
    const years = movies.map(m => m.year).filter((y): y is number => !!y);
    const minYear = Math.min(...years), maxYear = Math.max(...years);
    const span = Math.max(maxYear - minYear, 1);

    const genres = [...new Set(movies.map(m => m.genres[0]).filter(Boolean))];
    const genreAngle = new Map(
      genres.map((g, i) => [g, (i / genres.length) * 2 * Math.PI - Math.PI / 2])
    );

    const getR = (year?: number) =>
      !year ? minDim * 0.38 : minDim * (0.06 + ((year - minYear) / span) * 0.60);
    const getA = (m: Movie) => genreAngle.get(m.genres[0]) ?? 0;

    const decades = [...new Set(years.map(y => Math.floor(y / 10) * 10))].sort((a, b) => a - b);

    return {
      links: buildTemporalLinks(movies),
      xForce: d3.forceX<GalaxyNode>(n => cx + getR(n.movie.year) * Math.cos(getA(n.movie))).strength(0.14),
      yForce: d3.forceY<GalaxyNode>(n => cy + getR(n.movie.year) * Math.sin(getA(n.movie))).strength(0.14),
      linkDistance: 80,
      linkStrength: 0.2,
      chargeStrength: -280,
      annotations: {
        mode: 'temporal', cx, cy,
        rings: decades.map(d => ({ r: getR(d), label: `${d}s` })),
      },
    };
  }

  // ── Mood ───────────────────────────────────────────────────────────────────
  const scaleX = minDim * 0.42, scaleY = minDim * 0.38;
  return {
    links: buildMoodLinks(movies),
    xForce: d3.forceX<GalaxyNode>(n => cx + movieMood(n.movie).tone   * scaleX).strength(0.2),
    yForce: d3.forceY<GalaxyNode>(n => cy - movieMood(n.movie).energy * scaleY).strength(0.2),
    linkDistance: 50,
    linkStrength: 0.08,
    chargeStrength: -220,
    annotations: { mode: 'mood', cx, cy, scaleX, scaleY },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface GalaxyProps {
  movies: Movie[];
  selectedMovie: Movie | null;
  onSelectMovie: (movie: Movie | null) => void;
  layout: LayoutMode;
}

export function Galaxy({ movies, selectedMovie, onSelectMovie, layout }: GalaxyProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef       = useRef<d3.Simulation<GalaxyNode, GalaxyLink> | null>(null);
  const nodesRef     = useRef<GalaxyNode[]>([]);
  const linksRef     = useRef<GalaxyLink[]>([]);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const hoveredRef   = useRef<GalaxyNode | null>(null);
  const selectedRef  = useRef<Movie | null>(selectedMovie);
  const drawRef      = useRef<() => void>(() => undefined);
  const annRef       = useRef<AnnotationData>({ mode: 'collaborative' });
  const wRef         = useRef(0);
  const hRef         = useRef(0);

  // Poster cache
  const imgCacheRef   = useRef<Map<string, HTMLImageElement>>(new Map());
  const imgLoadingRef = useRef<Set<string>>(new Set());
  const imgFailedRef  = useRef<Set<string>>(new Set());

  // ── Sync selectedMovie without re-running the heavy effect ─────────────────
  useEffect(() => {
    selectedRef.current = selectedMovie;
    drawRef.current();
  }, [selectedMovie]);

  // ── Switch layout on the fly ───────────────────────────────────────────────
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !movies.length || !wRef.current) return;

    const cfg = buildLayout(layout, movies, wRef.current, hRef.current);
    linksRef.current  = cfg.links;
    annRef.current    = cfg.annotations;

    (sim.force('link') as d3.ForceLink<GalaxyNode, GalaxyLink>)
      .links(cfg.links)
      .distance(cfg.linkDistance)
      .strength(cfg.linkStrength);

    sim.force('x', cfg.xForce);
    sim.force('y', cfg.yForce);
    sim.force('charge', d3.forceManyBody<GalaxyNode>().strength(cfg.chargeStrength));

    sim.alpha(0.8).restart();
  }, [layout, movies]);

  // ── Node hit-test (screen → simulation coords) ────────────────────────────
  const getNodeAt = (mx: number, my: number): GalaxyNode | null => {
    const { x: tx, y: ty, k } = transformRef.current;
    const sx = (mx - tx) / k, sy = (my - ty) / k;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const r = nodeRadius(n.movie) + 6; // generous touch target
      if ((sx - n.x) ** 2 + (sy - n.y) ** 2 <= r * r) return n;
    }
    return null;
  };

  // ── Main setup: runs once when movies load ─────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !movies.length) return;

    const canvas    = canvasRef.current;
    const container = containerRef.current;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      wRef.current = w; hRef.current = h;
      canvas.width  = w * dpr; canvas.height = h * dpr;
      canvas.style.width  = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const w = wRef.current, h = hRef.current;

    // Build initial nodes
    const nodes: GalaxyNode[] = movies.map(m => ({
      id: m.id, movie: m,
      x: w / 2 + (Math.random() - 0.5) * 60,
      y: h / 2 + (Math.random() - 0.5) * 60,
    }));
    nodesRef.current = nodes;

    // Initial layout config
    const cfg = buildLayout(layout, movies, w, h);
    linksRef.current = cfg.links;
    annRef.current   = cfg.annotations;

    // ── Draw ─────────────────────────────────────────────────────────────────
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cw = canvas.width / dpr, ch = canvas.height / dpr;
      const { x: tx, y: ty, k } = transformRef.current;

      ctx.clearRect(0, 0, cw, ch);

      // Background — warm paper radial gradient
      const bg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.65);
      bg.addColorStop(0, '#f9f7f2');
      bg.addColorStop(1, '#ece7dc');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);

      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(k, k);

      // ── Layout annotations (drawn behind everything) ──────────────────────
      const ann = annRef.current;

      if (ann.mode === 'temporal') {
        ann.rings.forEach(({ r, label }) => {
          ctx.beginPath();
          ctx.arc(ann.cx, ann.cy, r, 0, Math.PI * 2);
          ctx.setLineDash([3 / k, 9 / k]);
          ctx.strokeStyle = 'rgba(0,0,0,0.055)';
          ctx.lineWidth = 0.5 / k;
          ctx.stroke();
          ctx.setLineDash([]);

          const fs = Math.max(9 / k, 0.5);
          ctx.font = `400 ${fs}px -apple-system, system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, ann.cx + r + 5 / k, ann.cy);
        });
      }

      if (ann.mode === 'mood') {
        const { cx: acx, cy: acy, scaleX: sx2, scaleY: sy2 } = ann;
        // Axes
        ctx.strokeStyle = 'rgba(0,0,0,0.07)';
        ctx.lineWidth = 0.5 / k;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(acx - sx2 - 12 / k, acy); ctx.lineTo(acx + sx2 + 12 / k, acy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(acx, acy - sy2 - 12 / k); ctx.lineTo(acx, acy + sy2 + 12 / k); ctx.stroke();

        // Quadrant watermarks
        const ql = Math.max(13 / k, 1);
        ctx.font = `700 ${ql}px -apple-system, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,0.065)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ARTHOUSE', acx - sx2 * 0.52, acy - sy2 * 0.62);
        ctx.fillText('THRILLER',  acx + sx2 * 0.52, acy - sy2 * 0.62);
        ctx.fillText('DRAMA',     acx - sx2 * 0.52, acy + sy2 * 0.62);
        ctx.fillText('COMEDY',    acx + sx2 * 0.52, acy + sy2 * 0.62);

        // Axis endpoint labels
        const al = Math.max(10 / k, 0.8);
        ctx.font = `500 ${al}px -apple-system, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.textAlign = 'center';
        ctx.fillText('← Dark',   acx - sx2 * 0.9,  acy + 14 / k);
        ctx.fillText('Light →',  acx + sx2 * 0.9,  acy + 14 / k);
        ctx.textAlign = 'left';
        ctx.fillText('↑ Kinetic', acx + 6 / k, acy - sy2 * 0.87);
        ctx.fillText('↓ Slow',    acx + 6 / k, acy + sy2 * 0.87);
      }

      // ── Links ─────────────────────────────────────────────────────────────
      ctx.lineWidth = 0.6 / k;
      linksRef.current.forEach(link => {
        const src = link.source as GalaxyNode;
        const tgt = link.target as GalaxyNode;
        if (src.x == null || tgt.x == null || src.y == null || tgt.y == null) return;
        const opacity = ann.mode === 'collaborative'
          ? Math.min(0.18, 0.04 + (link.value ?? 1) * 0.025)
          : 0.09;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = `rgba(0,0,0,${opacity})`;
        ctx.stroke();
      });

      // ── Nodes ─────────────────────────────────────────────────────────────
      nodesRef.current.forEach(node => {
        if (node.x == null || node.y == null) return;
        const r   = nodeRadius(node.movie);
        const isSel = selectedRef.current?.id === node.movie.id;
        const isHov = hoveredRef.current?.id  === node.id;
        const color = genreRgb(node.movie.genres);

        // Lazy-load poster on first encounter
        const id = node.movie.id;
        const img = imgCacheRef.current.get(id);
        if (!img && !imgLoadingRef.current.has(id) && !imgFailedRef.current.has(id)) {
          imgLoadingRef.current.add(id);
          const el = new Image();
          el.onload = () => { imgLoadingRef.current.delete(id); imgCacheRef.current.set(id, el); drawRef.current(); };
          el.onerror = () => { imgLoadingRef.current.delete(id); imgFailedRef.current.add(id); };
          el.src = `/api/poster/${id}`;
        }

        // Selection / hover rings (behind node body)
        if (isSel) {
          ctx.beginPath(); ctx.arc(node.x, node.y, r + 6 / k, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2.5 / k; ctx.stroke();
          ctx.beginPath(); ctx.arc(node.x, node.y, r + 11 / k, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8 / k; ctx.stroke();
        } else if (isHov) {
          ctx.beginPath(); ctx.arc(node.x, node.y, r + 4 / k, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.5 / k; ctx.stroke();
        }

        if (img) {
          // Poster clipped to circle
          ctx.save();
          ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.clip();
          const aspect = img.naturalWidth / img.naturalHeight;
          const d = r * 2;
          const [sw, sh, sx3, sy3] = aspect <= 1
            ? [d,          d / aspect, node.x - r,       node.y - (d / aspect) / 2]
            : [d * aspect, d,          node.x - (d * aspect) / 2, node.y - r];
          ctx.drawImage(img, sx3, sy3, sw, sh);
          // Edge vignette
          const vig = ctx.createRadialGradient(node.x, node.y, r * 0.45, node.x, node.y, r);
          vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.3)');
          ctx.fillStyle = vig;
          ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          // Border ring
          ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = isSel ? 'rgba(255,255,255,0.95)' : isHov ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = (isSel ? 2.5 : isHov ? 2 : 1) / k;
          ctx.stroke();
        } else {
          // Fallback dark circle
          const cx2 = node.x - r * 0.3, cy2 = node.y - r * 0.3;
          const grad = ctx.createRadialGradient(cx2, cy2, 0, node.x, node.y, r);
          const light = lighten(color, isSel ? 0.5 : isHov ? 0.35 : 0.18);
          grad.addColorStop(0, rgb(...light)); grad.addColorStop(1, rgb(...color));
          ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = grad; ctx.fill();
        }
      });

      // ── Hover label ───────────────────────────────────────────────────────
      const hn = hoveredRef.current;
      if (hn && hn.x != null && hn.y != null) {
        const r  = nodeRadius(hn.movie);
        const fs = Math.max(11 / k, 1.5);
        ctx.font = `500 ${fs}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const label = hn.movie.year ? `${hn.movie.title}  ·  ${hn.movie.year}` : hn.movie.title;
        const tw = ctx.measureText(label).width;
        const pad = 5 / k, lx = hn.x, ly = hn.y - r - 8 / k;
        const bx = lx - tw / 2 - pad, by = ly - fs - pad, bw = tw + pad * 2, bh = fs + pad * 2, br = bh / 2;
        ctx.beginPath();
        ctx.moveTo(bx + br, by); ctx.lineTo(bx + bw - br, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
        ctx.lineTo(bx + bw, by + bh - br);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
        ctx.lineTo(bx + br, by + bh); ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
        ctx.lineTo(bx, by + br); ctx.quadraticCurveTo(bx, by, bx + br, by); ctx.closePath();
        ctx.fillStyle = 'rgba(249,247,242,0.94)'; ctx.fill();
        ctx.fillStyle = '#1a1a1a'; ctx.fillText(label, lx, ly);
      }

      ctx.restore();
    };

    drawRef.current = draw;

    // ── D3 simulation ─────────────────────────────────────────────────────────
    const sim = d3.forceSimulation<GalaxyNode>(nodes)
      .force('link', d3.forceLink<GalaxyNode, GalaxyLink>(cfg.links)
        .id(d => d.id).distance(cfg.linkDistance).strength(cfg.linkStrength))
      .force('charge',    d3.forceManyBody<GalaxyNode>().strength(cfg.chargeStrength))
      .force('collision', d3.forceCollide<GalaxyNode>().radius(d => nodeRadius(d.movie) + 14));

    sim.force('x', cfg.xForce);
    sim.force('y', cfg.yForce);
    sim.on('tick', draw);
    simRef.current = sim;

    // ── D3 zoom ───────────────────────────────────────────────────────────────
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.04, 10])
      .on('zoom', event => { transformRef.current = event.transform as d3.ZoomTransform; draw(); });
    const sel = d3.select(canvas).call(zoom);

    // ── Mouse ─────────────────────────────────────────────────────────────────
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node?.id !== hoveredRef.current?.id) {
        hoveredRef.current = node;
        canvas.style.cursor = node ? 'pointer' : 'default';
        draw();
      }
    };
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      onSelectMovie(node ? node.movie : null);
    };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);

    // ── Touch ─────────────────────────────────────────────────────────────────
    let tStart = 0, tSX = 0, tSY = 0, pinchDist = 0, pinchMX = 0, pinchMY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        tStart = Date.now(); tSX = e.touches[0].clientX; tSY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist = Math.sqrt(dx * dx + dy * dy);
        pinchMX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pinchMY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) { hoveredRef.current = null; }
      else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (pinchDist > 0) {
          const { x: tx2, y: ty2, k } = transformRef.current;
          const rect = canvas.getBoundingClientRect();
          const scale = dist / pinchDist, nk = Math.min(10, Math.max(0.04, k * scale));
          const cx3 = mx - rect.left, cy3 = my - rect.top;
          transformRef.current = d3.zoomIdentity
            .translate(cx3 - (cx3 - tx2) * (nk / k) + (mx - pinchMX), cy3 - (cy3 - ty2) * (nk / k) + (my - pinchMY))
            .scale(nk);
          draw();
        }
        pinchDist = dist; pinchMX = mx; pinchMY = my;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 1 && Date.now() - tStart < 300) {
        const dx = e.changedTouches[0].clientX - tSX, dy = e.changedTouches[0].clientY - tSY;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          const rect = canvas.getBoundingClientRect();
          const node = getNodeAt(e.changedTouches[0].clientX - rect.left, e.changedTouches[0].clientY - rect.top);
          onSelectMovie(node ? node.movie : null);
        }
      }
      pinchDist = 0;
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });

    // ── Resize ────────────────────────────────────────────────────────────────
    const onResize = () => { resize(); draw(); };
    window.addEventListener('resize', onResize);

    draw();

    return () => {
      sim.stop();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
      sel.on('.zoom', null);
    };
  // layout intentionally excluded — the layout-switch effect handles it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies, onSelectMovie]);

  return (
    <div ref={containerRef} className="galaxy-wrapper">
      <canvas ref={canvasRef} className="galaxy-canvas" />
    </div>
  );
}
