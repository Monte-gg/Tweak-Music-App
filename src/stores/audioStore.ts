import { create } from "zustand";

export type TrackSource = "online" | "local";

export type Track = {
  id: string;
  title: string;
  artist: string;
  source: TrackSource;
  duration: number;
  cover: string;
  audioUrl?: string;
  externalUrl?: string;
  artworkUrl?: string;
  localTrackId?: string;
};

type AudioState = {
  queue: Track[];
  activeTrackId: string | null;
  isPlaying: boolean;
  isAuthenticated: boolean;
  isReady: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  equalizerGains: number[];
  bassBoost: number;
  crossfadeSeconds: number;
  crossfadeWarning: string | null;
  normalizerEnabled: boolean;
  seekSequence: number;
  playbackError: string | null;
  setAuthenticated: (isAuthenticated: boolean) => void;
  setReady: (isReady: boolean) => void;
  addToQueue: (track: Track) => void;
  updateTrackMetadata: (trackId: string, title: string, artist: string) => void;
  removeFromQueue: (trackId: string) => void;
  clearQueue: () => void;
  setActiveTrack: (trackId: string) => void;
  playTrack: (trackId: string) => void;
  togglePlayback: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (time: number) => void;
  setVolume: (volume: number) => void;
  setEqualizerGain: (band: number, gain: number) => void;
  setBassBoost: (gain: number) => void;
  setCrossfadeSeconds: (seconds: number) => void;
  setCrossfadeWarning: (message: string | null) => void;
  setNormalizerEnabled: (enabled: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackError: (message: string | null) => void;
};

const initialQueue: Track[] = [
  {
    id: "midnight-city",
    title: "Midnight City",
    artist: "M83",
    source: "online",
    duration: 243,
    cover: "cover-pink",
  },
  {
    id: "sweet-disposition",
    title: "Sweet Disposition",
    artist: "The Temper Trap",
    source: "local",
    duration: 234,
    cover: "cover-orange",
  },
  {
    id: "tadow",
    title: "Tadow",
    artist: "Masego, FKJ",
    source: "online",
    duration: 302,
    cover: "cover-green",
  },
];

function activeTrack(queue: Track[], activeTrackId: string | null): Track | undefined {
  return queue.find((track) => track.id === activeTrackId);
}

export function hasPlayableSource(track: Track | undefined): boolean {
  return Boolean(
    track?.audioUrl || (track?.source === "local" && track.localTrackId),
  );
}

function canPlayTrack(state: Pick<AudioState, "isAuthenticated" | "queue" | "activeTrackId">) {
  return (
    state.isAuthenticated &&
    hasPlayableSource(activeTrack(state.queue, state.activeTrackId))
  );
}

export const useAudioStore = create<AudioState>((set, get) => ({
  queue: initialQueue,
  activeTrackId: initialQueue[0]?.id ?? null,
  isPlaying: false,
  isAuthenticated: false,
  isReady: false,
  currentTime: 0,
  duration: initialQueue[0]?.duration ?? 0,
  volume: 0.8,
  equalizerGains: Array.from({ length: 10 }, () => 0),
  bassBoost: 0,
  crossfadeSeconds: 0,
  crossfadeWarning: null,
  normalizerEnabled: false,
  seekSequence: 0,
  playbackError: null,

  setAuthenticated: (isAuthenticated) =>
    set((state) => ({
      isAuthenticated,
      isPlaying: isAuthenticated ? state.isPlaying : false,
    })),

  setReady: (isReady) => set({ isReady }),

  addToQueue: (track) =>
    set((state) => ({
      queue: state.queue.some((queuedTrack) => queuedTrack.id === track.id)
        ? state.queue
        : [...state.queue, track],
    })),

  updateTrackMetadata: (trackId, title, artist) =>
    set((state) => ({
      queue: state.queue.map((track) =>
        track.id === trackId ? { ...track, title, artist } : track,
      ),
    })),

  removeFromQueue: (trackId) =>
    set((state) => {
      const queue = state.queue.filter((track) => track.id !== trackId);
      if (state.activeTrackId !== trackId) {
        return { queue };
      }

      const nextTrack = queue[0];
      return {
        queue,
        activeTrackId: nextTrack?.id ?? null,
        currentTime: 0,
        duration: nextTrack?.duration ?? 0,
        isPlaying: Boolean(state.isAuthenticated && hasPlayableSource(nextTrack)),
        isReady: false,
        seekSequence: state.seekSequence + 1,
        playbackError: null,
      };
    }),

  clearQueue: () =>
    set((state) => ({
      queue: [],
      activeTrackId: null,
      isPlaying: false,
      isReady: false,
      currentTime: 0,
      duration: 0,
      seekSequence: state.seekSequence + 1,
      playbackError: null,
    })),

  setActiveTrack: (trackId) =>
    set((state) => {
      const track = state.queue.find((item) => item.id === trackId);
      if (!track) {
        return state;
      }
      return {
        activeTrackId: track.id,
        isPlaying: false,
        isReady: false,
        currentTime: 0,
        duration: track.duration,
        seekSequence: state.seekSequence + 1,
        playbackError: null,
      };
    }),

  playTrack: (trackId) =>
    set((state) => {
      const track = state.queue.find((item) => item.id === trackId);
      if (!track) {
        return state;
      }
      const canPlay = state.isAuthenticated && hasPlayableSource(track);
      return {
        activeTrackId: track.id,
        isPlaying: canPlay,
        isReady: false,
        currentTime: 0,
        duration: track.duration,
        seekSequence: state.seekSequence + 1,
        playbackError: canPlay ? null : state.playbackError,
      };
    }),

  togglePlayback: () => {
    const state = get();
    if (!canPlayTrack(state)) {
      return;
    }
    set({ isPlaying: !state.isPlaying, playbackError: null });
  },

  play: () => {
    if (canPlayTrack(get())) {
      set({ isPlaying: true, playbackError: null });
    }
  },

  pause: () => set({ isPlaying: false }),

  next: () =>
    set((state) => {
      const index = state.queue.findIndex((track) => track.id === state.activeTrackId);
      const nextTrack = state.queue[index + 1];
      if (!nextTrack) {
        return { isPlaying: false };
      }
      return {
        activeTrackId: nextTrack.id,
        currentTime: 0,
        duration: nextTrack.duration,
        isPlaying: Boolean(state.isAuthenticated && hasPlayableSource(nextTrack)),
        isReady: false,
        seekSequence: state.seekSequence + 1,
        playbackError: null,
      };
    }),

  previous: () => {
    const state = get();
    if (state.currentTime > 3) {
      get().seekTo(0);
      return;
    }
    const index = state.queue.findIndex((track) => track.id === state.activeTrackId);
    const previousTrack = state.queue[index - 1];
    if (previousTrack) {
      get().playTrack(previousTrack.id);
    } else {
      get().seekTo(0);
    }
  },

  seekTo: (time) =>
    set((state) => ({
      currentTime: Math.max(0, Math.min(time, state.duration || time)),
      seekSequence: state.seekSequence + 1,
      playbackError: null,
    })),

  setVolume: (volume) =>
    set({ volume: Math.max(0, Math.min(1, volume)) }),

  setEqualizerGain: (band, gain) =>
    set((state) => {
      if (!Number.isInteger(band) || band < 0 || band >= state.equalizerGains.length) {
        return state;
      }
      const equalizerGains = [...state.equalizerGains];
      equalizerGains[band] = Math.max(-12, Math.min(12, gain));
      return { equalizerGains };
    }),

  setBassBoost: (gain) =>
    set({ bassBoost: Math.max(0, Math.min(12, gain)) }),

  setCrossfadeSeconds: (seconds) =>
    set({
      crossfadeSeconds: Math.max(0, Math.min(12, seconds)),
      crossfadeWarning: null,
    }),

  setCrossfadeWarning: (crossfadeWarning) => set({ crossfadeWarning }),

  setNormalizerEnabled: (normalizerEnabled) => set({ normalizerEnabled }),

  setCurrentTime: (time) =>
    set({ currentTime: Number.isFinite(time) ? Math.max(0, time) : 0 }),

  setDuration: (duration) =>
    set({ duration: Number.isFinite(duration) ? Math.max(0, duration) : 0 }),

  setPlaybackError: (playbackError) =>
    set({ playbackError, isPlaying: false }),
}));

export function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}
