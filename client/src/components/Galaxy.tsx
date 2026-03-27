import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import type { Movie, GalaxyNode, GalaxyLink } from '../types';

// ── Genre colour palette (dark ink tones on warm paper) ──────────────────────

const GENRE_COLORS: Record<string, [number, number, number]> = {
  'Action':           [15, 25, 60],
  'Adventure':        [40, 25, 10],
  'Animation':        [35, 30, 5],
  'Comedy':           [45, 15, 20],
  'Crime':            [40, 10, 10],
  'Documentary':      [10, 35, 28],
  'Drama':            [12, 35, 12],
  'Fantasy':          [30, 10, 45],
  'Horror':           [45, 5, 5],
  'Music':            [40, 8, 35],
  'Mystery':          [15, 15, 45],
  'Romance':          [45, 8, 18],
  'Science Fiction':  [5, 28, 45],
  'Sci-Fi':           [5, 28, 45],
  'Thriller':         [22, 8, 45],
  'War':              [28, 28, 10],
  'Western':          [45, 20, 5],
};
const DEFAULT_COLOR: [number, number, number] = [20, 20, 20];

function genreRgb(genres: string[]): [number, number, number] {
  for (const g of genres) {
    const c = GENRE_COLORS[g];
    if (c) return c;
  }
  return DEFAULT_COLOR;
}

function rgb(r: number, g: number, b: number, a = 1) {
  return `rgba(${r},${g},${b},${a})`;
}

function lighten([r, g, b]: [number, number, number], amt: number): [number, number, number] {
  return [
    Math.min(255, Math.round(r + (255 - r) * amt)),
    Math.min(255, Math.round(g + (255 - g) * amt)),
    Math.min(255, Math.round(b + (255 - b) * amt)),
  ];
}

function nodeRadius(movie: Movie): number {
  const base = 22;
  const bonus = ((movie.rating ?? 5) / 10) * 8;
  return base + bonus;
}

// ── Component ────────────────────────────────────────────────────────────────

interface GalaxyProps {
  movies: Movie[];
  selectedMovie: Movie | null;
  onSelectMovie: (movie: Movie | null) => void;
}

export function Galaxy({ movies, selectedMovie, onSelectMovie }: GalaxyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<GalaxyNode, GalaxyLink> | null>(null);
  const nodesRef = useRef<GalaxyNode[]>([]);
  const linksRef = useRef<GalaxyLink[]>([]);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const hoveredRef = useRef<GalaxyNode | null>(null);
  const selectedRef = useRef<Movie | null>(selectedMovie);
  const drawRef = useRef<() => void>(() => undefined);
  // Poster image cache — persists across re-renders; keyed by movie id
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const imgLoadingRef = useRef<Set<string>>(new Set());   // in-flight requests
  const imgFailedRef = useRef<Set<string>>(new Set());    // permanent failures

  // Keep selectedRef in sync without re-running the heavy effect
  useEffect(() => {
    selectedRef.current = selectedMovie;
    drawRef.current();
  }, [selectedMovie]);

  // ── Utility: find node under canvas coords ─────────────────────────────────
  const getNodeAt = useCallback((mx: number, my: number): GalaxyNode | null => {
    const { x: tx, y: ty, k } = transformRef.current;
    const sx = (mx - tx) / k;
    const sy = (my - ty) / k;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const dx = sx - n.x;
      const dy = sy - n.y;
      const r = nodeRadius(n.movie);
      // enlarge hit area for touch
      if (dx * dx + dy * dy <= (r + 6) * (r + 6)) return n;
    }
    return null;
  }, []);

  // ── Main setup effect ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || movies.length === 0) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const dpr = window.devicePixelRatio || 1;

    // Size canvas to container
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ── Build simulation nodes & links ────────────────────────────────────────
    const nodes: GalaxyNode[] = movies.map(movie => ({
      id: movie.id,
      movie,
      x: w / 2 + (Math.random() - 0.5) * 80,
      y: h / 2 + (Math.random() - 0.5) * 80,
    }));

    // Group movies by director, link if director has 2–8 movies
    const byDirector = new Map<string, string[]>();
    movies.forEach(m => {
      m.directors.forEach(dir => {
        if (!byDirector.has(dir)) byDirector.set(dir, []);
        byDirector.get(dir)!.push(m.id);
      });
    });

    const links: GalaxyLink[] = [];
    byDirector.forEach(ids => {
      if (ids.length >= 2 && ids.length <= 10) {
        for (let i = 0; i < ids.length - 1; i++) {
          links.push({ source: ids[i], target: ids[i + 1] });
        }
      }
    });

    nodesRef.current = nodes;
    linksRef.current = links;

    // Genre cluster centres arranged in a ring
    const genres = [...new Set(movies.map(m => m.genres[0]).filter(Boolean))];
    const genreCenters: Record<string, { x: number; y: number }> = {};
    genres.forEach((genre, i) => {
      const angle = (i / genres.length) * 2 * Math.PI - Math.PI / 2;
      const r = Math.min(w, h) * 0.3;
      genreCenters[genre] = {
        x: w / 2 + r * Math.cos(angle),
        y: h / 2 + r * Math.sin(angle),
      };
    });

    // ── Draw function ─────────────────────────────────────────────────────────
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;

      ctx.clearRect(0, 0, cw, ch);

      // Warm paper background
      const bg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.65);
      bg.addColorStop(0, '#f9f7f2');
      bg.addColorStop(1, '#ece7dc');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);

      ctx.save();
      const { x: tx, y: ty, k } = transformRef.current;
      ctx.translate(tx, ty);
      ctx.scale(k, k);

      // ── Links (director constellations) ─────────────────────────────────────
      ctx.lineWidth = 0.6 / k;
      linksRef.current.forEach(link => {
        const src = link.source as GalaxyNode;
        const tgt = link.target as GalaxyNode;
        if (src.x == null || tgt.x == null || src.y == null || tgt.y == null) return;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = 'rgba(0,0,0,0.09)';
        ctx.stroke();
      });

      // ── Nodes ───────────────────────────────────────────────────────────────
      nodesRef.current.forEach(node => {
        if (node.x == null || node.y == null) return;
        const r = nodeRadius(node.movie);
        const isSelected = selectedRef.current?.id === node.movie.id;
        const isHovered = hoveredRef.current?.id === node.id;
        const color = genreRgb(node.movie.genres);

        // ── Lazy-load poster on first draw ───────────────────────────────────
        const id = node.movie.id;
        const cachedImg = imgCacheRef.current.get(id);
        if (!cachedImg && !imgLoadingRef.current.has(id) && !imgFailedRef.current.has(id)) {
          imgLoadingRef.current.add(id);
          const img = new Image();
          img.onload = () => {
            imgLoadingRef.current.delete(id);
            imgCacheRef.current.set(id, img);
            drawRef.current(); // repaint once image is ready
          };
          img.onerror = () => {
            imgLoadingRef.current.delete(id);
            imgFailedRef.current.add(id);
          };
          img.src = `/api/poster/${id}`;
        }

        // ── Selection rings (drawn behind the node body) ─────────────────────
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6 / k, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.lineWidth = 2.5 / k;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 11 / k, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 0.8 / k;
          ctx.stroke();
        } else if (isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4 / k, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.22)';
          ctx.lineWidth = 1.5 / k;
          ctx.stroke();
        }

        if (cachedImg) {
          // ── Draw poster clipped to circle ──────────────────────────────────
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.clip();

          // Cover-fit: scale so the shorter axis fills the diameter
          const aspect = cachedImg.naturalWidth / cachedImg.naturalHeight;
          const d = r * 2;
          let sw: number, sh: number, sx: number, sy: number;
          if (aspect <= 1) {
            // Portrait poster — fill by width
            sw = d;
            sh = d / aspect;
            sx = node.x - r;
            sy = node.y - sh / 2;
          } else {
            // Landscape — fill by height
            sw = d * aspect;
            sh = d;
            sx = node.x - sw / 2;
            sy = node.y - r;
          }
          ctx.drawImage(cachedImg, sx, sy, sw, sh);

          // Subtle edge vignette for depth
          const vignette = ctx.createRadialGradient(node.x, node.y, r * 0.45, node.x, node.y, r);
          vignette.addColorStop(0, 'rgba(0,0,0,0)');
          vignette.addColorStop(1, 'rgba(0,0,0,0.3)');
          ctx.fillStyle = vignette;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();

          // Border ring over the poster
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected
            ? 'rgba(255,255,255,0.95)'
            : isHovered
              ? 'rgba(255,255,255,0.75)'
              : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = (isSelected ? 2.5 : isHovered ? 2 : 1) / k;
          ctx.stroke();
        } else {
          // ── Fallback dark circle (while loading / on error) ────────────────
          const cx = node.x - r * 0.3;
          const cy = node.y - r * 0.3;
          const grad = ctx.createRadialGradient(cx, cy, 0, node.x, node.y, r);
          const light = lighten(color, isSelected ? 0.5 : isHovered ? 0.35 : 0.18);
          grad.addColorStop(0, rgb(...light));
          grad.addColorStop(1, rgb(...color));
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }
      });

      // ── Hover label ─────────────────────────────────────────────────────────
      const hNode = hoveredRef.current;
      if (hNode && hNode.x != null && hNode.y != null) {
        const r = nodeRadius(hNode.movie);
        const fs = Math.max(11 / k, 1.5);
        ctx.font = `500 ${fs}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const label = hNode.movie.year
          ? `${hNode.movie.title}  ·  ${hNode.movie.year}`
          : hNode.movie.title;
        const tw = ctx.measureText(label).width;
        const pad = 5 / k;
        const lx = hNode.x;
        const ly = hNode.y - r - 8 / k;

        // Background pill
        const bx = lx - tw / 2 - pad;
        const by = ly - fs - pad;
        const bw = tw + pad * 2;
        const bh = fs + pad * 2;
        const br = bh / 2;

        ctx.beginPath();
        ctx.moveTo(bx + br, by);
        ctx.lineTo(bx + bw - br, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
        ctx.lineTo(bx + bw, by + bh - br);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
        ctx.lineTo(bx + br, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
        ctx.lineTo(bx, by + br);
        ctx.quadraticCurveTo(bx, by, bx + br, by);
        ctx.closePath();
        ctx.fillStyle = 'rgba(249,247,242,0.94)';
        ctx.fill();

        ctx.fillStyle = '#1a1a1a';
        ctx.fillText(label, lx, ly);
      }

      ctx.restore();
    };

    drawRef.current = draw;

    // ── D3 force simulation ──────────────────────────────────────────────────
    const simulation = d3
      .forceSimulation<GalaxyNode>(nodes)
      .force(
        'link',
        d3.forceLink<GalaxyNode, GalaxyLink>(links)
          .id(d => d.id)
          .distance(140)
          .strength(0.25)
      )
      .force('charge', d3.forceManyBody<GalaxyNode>().strength(-500))
      .force(
        'collision',
        d3.forceCollide<GalaxyNode>().radius(d => nodeRadius(d.movie) + 14)
      )
      .force(
        'x',
        d3.forceX<GalaxyNode>(node => {
          const g = node.movie.genres[0];
          return g && genreCenters[g] ? genreCenters[g].x : w / 2;
        }).strength(0.06)
      )
      .force(
        'y',
        d3.forceY<GalaxyNode>(node => {
          const g = node.movie.genres[0];
          return g && genreCenters[g] ? genreCenters[g].y : h / 2;
        }).strength(0.06)
      );

    simulation.on('tick', draw);
    simRef.current = simulation;

    // ── D3 zoom ───────────────────────────────────────────────────────────────
    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.04, 10])
      .on('zoom', event => {
        transformRef.current = event.transform as d3.ZoomTransform;
        draw();
      });

    const sel = d3.select(canvas).call(zoom);

    // ── Mouse events ──────────────────────────────────────────────────────────
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

    // ── Touch events (tablet) ─────────────────────────────────────────────────
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let lastPinchDist = 0;
    let lastPinchMidX = 0;
    let lastPinchMidY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartTime = Date.now();
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDist = Math.sqrt(dx * dx + dy * dy);
        lastPinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastPinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      if (e.touches.length === 1) {
        // Single-finger pan — mimic mousemove for hover (while panning via d3)
        hoveredRef.current = null;
      } else if (e.touches.length === 2) {
        // Pinch-to-zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = canvas.getBoundingClientRect();

        if (lastPinchDist > 0) {
          const scaleFactor = dist / lastPinchDist;
          const { x: tx, y: ty, k } = transformRef.current;
          const mx = midX - rect.left;
          const my = midY - rect.top;
          const panDx = midX - lastPinchMidX;
          const panDy = midY - lastPinchMidY;

          const newK = Math.min(10, Math.max(0.04, k * scaleFactor));
          const newX = mx - (mx - tx) * (newK / k) + panDx;
          const newY = my - (my - ty) * (newK / k) + panDy;

          transformRef.current = d3.zoomIdentity
            .translate(newX, newY)
            .scale(newK);
          draw();
        }
        lastPinchDist = dist;
        lastPinchMidX = midX;
        lastPinchMidY = midY;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 1 && Date.now() - touchStartTime < 300) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          // Tap — treat as click
          const rect = canvas.getBoundingClientRect();
          const node = getNodeAt(
            e.changedTouches[0].clientX - rect.left,
            e.changedTouches[0].clientY - rect.top
          );
          onSelectMovie(node ? node.movie : null);
        }
      }
      lastPinchDist = 0;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    // ── Window resize ─────────────────────────────────────────────────────────
    const onResize = () => {
      resize();
      draw();
    };
    window.addEventListener('resize', onResize);

    // ── Initial draw ──────────────────────────────────────────────────────────
    draw();

    return () => {
      simulation.stop();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
      sel.on('.zoom', null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies, onSelectMovie, getNodeAt]);

  return (
    <div ref={containerRef} className="galaxy-wrapper">
      <canvas ref={canvasRef} className="galaxy-canvas" />
    </div>
  );
}
