import type { LayoutMode } from '../types';

interface TopBarProps {
  layout: LayoutMode;
  onLayoutChange: (l: LayoutMode) => void;
  movieCount: number;
}

const MODES: { id: LayoutMode; label: string; hint: string }[] = [
  {
    id: 'collaborative',
    label: 'Collaborative',
    hint: 'Clustered by shared cast & crew — stronger bonds pull films closer',
  },
  {
    id: 'temporal',
    label: 'Temporal',
    hint: 'Rings by decade, spokes by genre — director arcs cross the rings',
  },
  {
    id: 'mood',
    label: 'Mood Map',
    hint: 'Horizontal axis: dark → light  ·  Vertical axis: slow → kinetic',
  },
];

export function TopBar({ layout, onLayoutChange, movieCount }: TopBarProps) {
  return (
    <header className="top-bar">
      <span className="logo">Plex Galaxy</span>

      <nav className="layout-switcher" aria-label="Layout mode">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`layout-btn${layout === m.id ? ' active' : ''}`}
            onClick={() => onLayoutChange(m.id)}
            title={m.hint}
            aria-pressed={layout === m.id}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <span className="movie-count">{movieCount.toLocaleString()} movies</span>
    </header>
  );
}
