import { useEffect, useRef } from "react";
import {
  hasPlayableSource,
  useAudioStore,
} from "../stores/audioStore";

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

function YouTubePlayer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const timerRef = useRef<number | null>(null);
  const queue = useAudioStore((state) => state.queue);
  const activeTrackId = useAudioStore((state) => state.activeTrackId);
  const activeTrack = queue.find((track) => track.id === activeTrackId);
  const videoId = activeTrack?.youtubeVideoId;
  const isAuthenticated = useAudioStore((state) => state.isAuthenticated);
  const isPlaying = useAudioStore((state) => state.isPlaying);
  const volume = useAudioStore((state) => state.volume);
  const seekSequence = useAudioStore((state) => state.seekSequence);
  const setCurrentTime = useAudioStore((state) => state.setCurrentTime);
  const setDuration = useAudioStore((state) => state.setDuration);
  const setReady = useAudioStore((state) => state.setReady);
  const setPlaybackError = useAudioStore((state) => state.setPlaybackError);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeIframeApi().catch((error: unknown) => {
      if (!cancelled) {
        console.error("Tweak could not preload YouTube's music player.", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
            controls: 1,
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

  if (!videoId || !isAuthenticated || !hasPlayableSource(activeTrack)) {
    return null;
  }

  return (
    <aside className="youtube-player-dock" aria-label="YouTube music player">
      <div className="youtube-player-heading">
        <span>Now playing on YouTube</span>
        <strong>{activeTrack.title}</strong>
      </div>
      <div className="youtube-player-frame">
        <div key={videoId} ref={mountRef} />
      </div>
    </aside>
  );
}

export default YouTubePlayer;
