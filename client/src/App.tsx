import { useState, useCallback } from 'react';
import { useMovies } from './hooks/useMovies';
import { Galaxy } from './components/Galaxy';
import { MoviePanel } from './components/MoviePanel';
import { SetupScreen } from './components/SetupScreen';
import { TopBar } from './components/TopBar';
import type { Movie, LayoutMode } from './types';

export default function App() {
  const { movies, status, error, reload } = useMovies();
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [layout, setLayout] = useState<LayoutMode>('collaborative');

  const handleSelectMovie = useCallback((movie: Movie | null) => {
    setSelectedMovie(movie);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedMovie(null);
  }, []);

  if (status === 'checking') {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="spinner" />
          <p>Connecting…</p>
        </div>
      </div>
    );
  }

  if (status === 'unconfigured') {
    return <SetupScreen onComplete={reload} />;
  }

  if (status === 'loading') {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="spinner" />
          <p>Loading your library…</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="splash">
        <div className="splash-inner error">
          <p className="error-msg">{error}</p>
          <button className="btn" onClick={reload}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar layout={layout} onLayoutChange={setLayout} movieCount={movies.length} />

      <div className="galaxy-container">
        <Galaxy
          movies={movies}
          selectedMovie={selectedMovie}
          onSelectMovie={handleSelectMovie}
          layout={layout}
        />
      </div>

      <MoviePanel movie={selectedMovie} onClose={handleClose} />
    </div>
  );
}
