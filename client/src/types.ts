import type * as d3 from 'd3';

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

export interface GalaxyNode extends d3.SimulationNodeDatum {
  id: string;
  movie: Movie;
}

export interface GalaxyLink extends d3.SimulationLinkDatum<GalaxyNode> {
  /** Collaboration score (collaborative layout) or undefined */
  value?: number;
}

export type LayoutMode = 'collaborative' | 'temporal' | 'mood';
