import { useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Music2,
  Pause,
  Play,
  Volume2,
} from "lucide-react";
import {
  hasPlayableSource,
  useAudioStore,
} from "../stores/audioStore";
import { useLocation } from "react-router-dom";

type YouTubePlayerInstance = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  loadVideoById: (videoId: string) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
};

type YouTubeIframeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      height: string;
      width: string;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: (event: { target: YouTubePlayerInstance }) => void;
        onStateChange: (event: {
          data: number;
          target: YouTubePlayerInstance;
        }) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayerInstance;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
  };
};

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeIframeApi> | null = null;

function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (apiPromise) {
    return apiPromise;
  }

  const loading = new Promise<YouTubeIframeApi>((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube's music player could not be initialized."));
      }
    };

    let script = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.append(script);
    }
    script.addEventListener(
      "error",
      () => {
        script?.remove();
        reject(new Error("YouTube's music player could not be loaded."));
      },
      { once: true },
    );
  }).catch((error: unknown) => {
    apiPromise = null;
    throw error;
  });
  apiPromise = loading;
  return loading;
}

function youtubeErrorMessage(code: number): string {
  if (code === 2) {
    return "This YouTube music video has an invalid video ID.";
  }
  if (code === 5) {
    return "This YouTube music video could not be played in this browser.";
  }
  if (code === 100) {
    return "This YouTube music video is no longer available.";
  }
  if (code === 101 || code === 150) {
    return "The owner does not allow this music video to play here.";
  }
  if (code === 153) {
    return "YouTube could not identify this app. Open the video on YouTube instead.";
  }
  return "YouTube could not play this music video.";
}

function PlaybackBar() {
  const location = useLocation();
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const timerRef = useRef<number | null>(null);
  const queue = useAudioStore((state) => state.queue);
  const activeTrackId = useAudioStore((state) => state.activeTrackId);
  const activeTrack = queue.find((track) => track.id === activeTrackId);
  const activeMode = location.pathname === "/app/offline" ? "local" : "online";
  const videoId = activeTrack?.youtubeVideoId;
  const isAuthenticated = useAudioStore((state) => state.isAuthenticated);
  const isPlaying = useAudioStore((state) => state.isPlaying);
  const isReady = useAudioStore((state) => state.isReady);
  const currentTime = useAudioStore((state) => state.currentTime);
  const duration = useAudioStore((state) => state.duration);
  const volume = useAudioStore((state) => state.volume);
  const seekSequence = useAudioStore((state) => state.seekSequence);
  const setCurrentTime = useAudioStore((state) => state.setCurrentTime);
  const setDuration = useAudioStore((state) => state.setDuration);
  const setReady = useAudioStore((state) => state.setReady);
  const setPlaybackError = useAudioStore((state) => state.setPlaybackError);
  const previousTrack = useAudioStore((state) => state.previous);
  const nextTrack = useAudioStore((state) => state.next);
  const seekTo = useAudioStore((state) => state.seekTo);
  const sameSourceQueue = activeTrack
    ? queue.filter((track) => track.source === activeTrack.source)
    : [];
  const activeSourceIndex = sameSourceQueue.findIndex(
    (track) => track.id === activeTrack?.id,
  );
  const canPlayPrevious = activeTrack
    ? activeSourceIndex > 0
    : false;
  const canPlayNext = activeTrack
    ? activeSourceIndex < sameSourceQueue.length - 1
    : false;

  useEffect(() => {
    if (activeTrack && activeTrack.source !== activeMode) {
      useAudioStore.getState().pause();
    }
  }, [activeMode, activeTrack?.source]);

  useEffect(() => {
    if (!videoId || !isAuthenticated || !mountRef.current) {
      return;
    }

    let cancelled = false;
    void loadYouTubeIframeApi()
      .then((youtube) => {
        if (cancelled || !mountRef.current) {
          return;
        }

        const player = new youtube.Player(mountRef.current, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            autoplay: useAudioStore.getState().isPlaying ? 1 : 0,
            controls: 0,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              playerRef.current = event.target;
              event.target.setVolume(
                Math.round(useAudioStore.getState().volume * 100),
              );
              setDuration(event.target.getDuration());
              setReady(true);
              if (useAudioStore.getState().isPlaying) {
                event.target.playVideo();
              }
            },
            onStateChange: (event) => {
              if (event.data === youtube.PlayerState.PLAYING) {
                setReady(true);
                useAudioStore.getState().play();
                if (timerRef.current !== null) {
                  window.clearInterval(timerRef.current);
                }
                timerRef.current = window.setInterval(() => {
                  setCurrentTime(event.target.getCurrentTime());
                  setDuration(event.target.getDuration());
                }, 500);
              } else {
                if (timerRef.current !== null) {
                  window.clearInterval(timerRef.current);
                  timerRef.current = null;
                }
                setCurrentTime(event.target.getCurrentTime());
                if (event.data === youtube.PlayerState.PAUSED) {
                  useAudioStore.getState().pause();
                } else if (event.data === youtube.PlayerState.ENDED) {
                  useAudioStore.getState().next();
                }
              }
            },
            onError: (event) => {
              setReady(false);
              setPlaybackError(youtubeErrorMessage(event.data));
            },
          },
        });
        playerRef.current = player;
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPlaybackError(
            error instanceof Error
              ? error.message
              : "YouTube's music player could not be loaded.",
          );
        }
      });

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [
    activeMode,
    isAuthenticated,
    setCurrentTime,
    setDuration,
    setPlaybackError,
    setReady,
    videoId,
  ]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !videoId || !isAuthenticated) {
      return;
    }
    if (isPlaying) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }
  }, [isAuthenticated, isPlaying, videoId]);

  useEffect(() => {
    playerRef.current?.setVolume(Math.round(volume * 100));
  }, [volume]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !videoId || !isAuthenticated) {
      return;
    }
    player.seekTo(useAudioStore.getState().currentTime, true);
  }, [isAuthenticated, seekSequence, videoId]);

  if (
    !activeTrack ||
    activeTrack.source !== activeMode ||
    !isAuthenticated ||
    !hasPlayableSource(activeTrack)
  ) {
    return null;
  }

  return (
    <aside className="playback-bar" aria-label="Now playing">
      <div className="playback-bar-source">
        {videoId ? (
          <div
            key={videoId}
            ref={mountRef}
            title={`Video for ${activeTrack.title}`}
          />
        ) : activeTrack.artworkUrl ? (
          <img src={activeTrack.artworkUrl} alt="" />
        ) : (
          <Music2 size={32} />
        )}
      </div>
      <div className="playback-bar-controls">
        <div className="playback-bar-track">
          {activeTrack.artworkUrl && (
            <img src={activeTrack.artworkUrl} alt="" loading="lazy" />
          )}
          <div>
            <strong>{activeTrack.title}</strong>
            <span>{activeTrack.artist}</span>
            <small>
              {videoId ? "Music video provided by YouTube" : "From your library"}
            </small>
          </div>
        </div>
        <div className="playback-bar-transport">
          <button
            type="button"
            className="transport-button"
            aria-label="Previous track"
            disabled={!canPlayPrevious}
            onClick={previousTrack}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            className="play-button"
            aria-label={isPlaying ? "Pause playback" : "Play"}
            onClick={() => {
              const state = useAudioStore.getState();
              if (state.isPlaying) {
                state.pause();
              } else {
                state.play();
              }
            }}
          >
            {isPlaying
              ? <Pause size={16} fill="currentColor" />
              : <Play size={16} fill="currentColor" />}
          </button>
          <button
            type="button"
            className="transport-button"
            aria-label="Next track"
            disabled={!canPlayNext}
            onClick={nextTrack}
          >
            <ArrowRight size={17} />
          </button>
        </div>
        <div className="playback-bar-seek">
          <span>{formatPlayerTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || activeTrack.duration}
            step={1}
            value={Math.min(currentTime, duration || activeTrack.duration)}
            aria-label="Seek through current track"
            disabled={!isReady}
            onChange={(event) => seekTo(Number(event.target.value))}
          />
          <span>{formatPlayerTime(duration || activeTrack.duration)}</span>
        </div>
        <label className="playback-bar-volume">
          <Volume2 size={15} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            aria-label="Volume"
            onChange={(event) =>
              useAudioStore.getState().setVolume(Number(event.target.value))
            }
          />
        </label>
      </div>
    </aside>
  );
}

function formatPlayerTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default PlaybackBar;
