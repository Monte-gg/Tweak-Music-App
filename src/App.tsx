import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  AudioWaveform,
  Bell,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Disc3,
  FolderOpen,
  Headphones,
  Heart,
  Library,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import AudioEngine from "./components/AudioEngine";
import AuthModal, { type AuthMode } from "./components/AuthModal";
import SpectrumVisualizer from "./components/SpectrumVisualizer";
import {
  importAudioFiles,
  listLocalTracks,
  removeLocalTrack,
  saveLocalTrackMetadata,
  type LocalAudioRecord,
} from "./lib/localLibrary";
import { searchYouTubeMusic, type MusicSearchResult } from "./lib/musicSearch";
import { getSupabaseClient } from "./lib/supabase";
import {
  formatTime,
  hasPlayableSource,
  type Track,
  useAudioStore,
} from "./stores/audioStore";

type Theme = "dark" | "light";

const discoveries = [
  {
    title: "After Hours",
    subtitle: "The late-night edit",
    query: "After Hours The Weeknd",
    gradient: "artwork-violet",
    icon: <Music2 size={20} />,
  },
  {
    title: "Soft Focus",
    subtitle: "Ease into the day",
    query: "ambient focus music",
    gradient: "artwork-blue",
    icon: <Waves size={20} />,
  },
  {
    title: "New Frequencies",
    subtitle: "Fresh finds for you",
    query: "new music hits",
    gradient: "artwork-coral",
    icon: <Sparkles size={20} />,
  },
];

const eqBandLabels = ["32", "63", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

function readSavedTheme(): Theme {
  try {
    return window.localStorage.getItem("tweak-theme") === "light"
      ? "light"
      : "dark";
  } catch (error) {
    console.warn("Unable to read the saved Tweak theme.", error);
    return "dark";
  }
}

function readFavoriteTrackIds(): string[] {
  try {
    const saved = window.localStorage.getItem("tweak-favorite-tracks");
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch (error) {
    console.warn("Unable to read saved favorite tracks.", error);
    return [];
  }
}

function isStoredTrack(value: unknown): value is Track {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const track = value as Record<string, unknown>;
  const optionalStrings = [
    "audioUrl",
    "youtubeVideoId",
    "artworkUrl",
    "localTrackId",
  ];
  return (
    typeof track.id === "string" &&
    typeof track.title === "string" &&
    typeof track.artist === "string" &&
    (track.source === "online" || track.source === "local") &&
    typeof track.duration === "number" &&
    Number.isFinite(track.duration) &&
    typeof track.cover === "string" &&
    optionalStrings.every(
      (key) => track[key] === undefined || typeof track[key] === "string",
    )
  );
}

function readFavoriteTrackDetails(): Track[] {
  try {
    const saved = window.localStorage.getItem("tweak-favorite-track-details");
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter(isStoredTrack) : [];
  } catch (error) {
    console.warn("Unable to read saved track details.", error);
    return [];
  }
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Headphones className="brand-headphones" size={27} strokeWidth={2.2} />
      <AudioLines className="brand-wave" size={14} strokeWidth={2.5} />
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {action && (
        <button className="text-button" type="button" onClick={onAction}>
          {action} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function App() {
  const [theme, setTheme] = useState<Theme>(readSavedTheme);
  const [authClient, setAuthClient] = useState<SupabaseClient | null>(() =>
    getSupabaseClient(),
  );
  const [user, setUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [studioMenuOpen, setStudioMenuOpen] = useState(false);
  const [playerMenuOpen, setPlayerMenuOpen] = useState(false);
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<string[]>(readFavoriteTrackIds);
  const [favoriteTrackDetails, setFavoriteTrackDetails] = useState<Track[]>(
    readFavoriteTrackDetails,
  );
  const [searchResults, setSearchResults] = useState<MusicSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [localTracks, setLocalTracks] = useState<LocalAudioRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryDragging, setLibraryDragging] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [editingTrack, setEditingTrack] = useState<LocalAudioRecord | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [editAlbum, setEditAlbum] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const [savingMetadata, setSavingMetadata] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const currentView =
    location.pathname === "/app/offline"
      ? "offline"
      : location.pathname === "/app/profile"
        ? "profile"
        : "online";
  const queue = useAudioStore((state) => state.queue);
  const onlineQueue = queue.filter(
    (track) => track.source === "online" && hasPlayableSource(track),
  );
  const offlineQueue = queue.filter(
    (track) => track.source === "local" && hasPlayableSource(track),
  );
  const visibleQueue = currentView === "offline" ? offlineQueue : onlineQueue;
  const activeTrackId = useAudioStore((state) => state.activeTrackId);
  const activeTrack = queue.find((track) => track.id === activeTrackId);
  const onlineActiveTrack = activeTrack?.source === "online" ? activeTrack : undefined;
  const isPlaying = useAudioStore((state) => state.isPlaying);
  const currentTime = useAudioStore((state) => state.currentTime);
  const duration = useAudioStore((state) => state.duration);
  const volume = useAudioStore((state) => state.volume);
  const equalizerGains = useAudioStore((state) => state.equalizerGains);
  const bassBoost = useAudioStore((state) => state.bassBoost);
  const crossfadeSeconds = useAudioStore((state) => state.crossfadeSeconds);
  const crossfadeWarning = useAudioStore((state) => state.crossfadeWarning);
  const normalizerEnabled = useAudioStore((state) => state.normalizerEnabled);
  const isReady = useAudioStore((state) => state.isReady);
  const playbackError = useAudioStore((state) => state.playbackError);
  const setAuthenticated = useAudioStore((state) => state.setAuthenticated);
  const togglePlayback = useAudioStore((state) => state.togglePlayback);
  const previousTrack = useAudioStore((state) => state.previous);
  const nextTrack = useAudioStore((state) => state.next);
  const playTrack = useAudioStore((state) => state.playTrack);
  const addToQueue = useAudioStore((state) => state.addToQueue);
  const updateTrackMetadata = useAudioStore((state) => state.updateTrackMetadata);
  const removeFromQueue = useAudioStore((state) => state.removeFromQueue);
  const clearQueueForSource = useAudioStore((state) => state.clearQueueForSource);
  const seekTo = useAudioStore((state) => state.seekTo);
  const setVolume = useAudioStore((state) => state.setVolume);
  const setEqualizerGain = useAudioStore((state) => state.setEqualizerGain);
  const setBassBoost = useAudioStore((state) => state.setBassBoost);
  const setCrossfadeSeconds = useAudioStore((state) => state.setCrossfadeSeconds);
  const setNormalizerEnabled = useAudioStore((state) => state.setNormalizerEnabled);
  const canPlay = Boolean(user && hasPlayableSource(onlineActiveTrack));
  const activeQueueIndex = onlineQueue.findIndex((track) => track.id === activeTrackId);
  const visualProgress =
    hasPlayableSource(onlineActiveTrack) && duration > 0
      ? Math.min(currentTime / duration, 1)
      : 0.31;

  const displayName =
    (typeof user?.user_metadata.username === "string" &&
      user.user_metadata.username) ||
    user?.email?.split("@")[0] ||
    "Guest";
  const displayInitial = displayName.slice(0, 1).toUpperCase();
  const searchedTracks: Track[] = searchResults.map((result) => ({
    id: `youtube-${result.id}`,
    title: result.title,
    artist: result.artist,
    source: "online",
    duration: result.duration,
    cover: "cover-pink",
    youtubeVideoId: result.id,
    artworkUrl: result.thumbnailUrl,
  }));
  const featuredOnlineTracks =
    searchedTracks.length > 0
      ? searchedTracks.slice(0, 3)
      : onlineQueue.slice(-3).reverse();
  const savedTracks = favoriteTrackIds
    .map(
      (trackId) =>
        favoriteTrackDetails.find((track) => track.id === trackId) ??
        queue.find((track) => track.id === trackId) ??
        (() => {
          const localTrack = localTracks.find((track) => track.id === trackId);
          return localTrack
            ? {
                id: localTrack.id,
                title: localTrack.title,
                artist: localTrack.artist,
                source: "local" as const,
                duration: localTrack.duration,
                cover: "cover-orange",
                localTrackId: localTrack.id,
              }
            : undefined;
        })(),
    )
    .filter((track): track is Track => Boolean(track));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("tweak-theme", theme);
    } catch (error) {
      console.warn("Unable to save the Tweak theme preference.", error);
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "tweak-favorite-tracks",
        JSON.stringify(favoriteTrackIds),
      );
    } catch (error) {
      console.warn("Unable to save favorite tracks.", error);
    }
  }, [favoriteTrackIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "tweak-favorite-track-details",
        JSON.stringify(favoriteTrackDetails),
      );
    } catch (error) {
      console.warn("Unable to save favorite track details.", error);
    }
  }, [favoriteTrackDetails]);

  useEffect(() => {
    setAuthenticated(Boolean(user));
  }, [setAuthenticated, user]);

  useEffect(() => {
    let active = true;
    void listLocalTracks()
      .then((tracks) => {
        if (active) {
          setLocalTracks(tracks);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLibraryError(
            error instanceof Error
              ? `Local library could not be opened: ${error.message}`
              : "Local library could not be opened.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLibraryLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !searchContainerRef.current?.contains(event.target)
      ) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [searchOpen]);

  useEffect(() => {
    if (currentView === "offline") {
      setSearchOpen(false);
      return;
    }

    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchError("");
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    setSearchResults([]);
    setSearchError("");
    setSearchLoading(true);
    const timeout = window.setTimeout(() => {
      void searchYouTubeMusic(query, controller.signal)
        .then((results) => setSearchResults(results))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setSearchError(
              error instanceof Error ? error.message : "Music search failed.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearchLoading(false);
          }
        });
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [currentView, searchQuery]);

  useEffect(() => {
    if (!authClient) {
      setUser(null);
      setAuthResolved(true);
      return;
    }

    let active = true;
    setAuthResolved(false);
    const sendPendingWelcome = async (session: Session) => {
      if (import.meta.env.VITE_EMAIL_API_ENABLED !== "true") {
        return;
      }

      const welcomePending =
        session.user.user_metadata.welcome_email_pending === true;
      const isNewGoogleAccount =
        session.user.app_metadata.provider === "google" &&
        Date.now() - Date.parse(session.user.created_at) < 10 * 60 * 1000 &&
        session.user.user_metadata.welcome_email_pending !== false;
      if (!welcomePending && !isNewGoogleAccount) {
        return;
      }

      try {
        if (isNewGoogleAccount && !welcomePending) {
          const { error } = await authClient.auth.updateUser({
            data: {
              ...session.user.user_metadata,
              welcome_email_pending: true,
            },
          });
          if (error) {
            throw error;
          }
        }

        const response = await fetch("/api/email/welcome", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) {
          const result = (await response.json()) as { error?: string };
          throw new Error(result.error ?? "Unable to send the welcome email.");
        }

        const { error } = await authClient.auth.updateUser({
          data: {
            ...session.user.user_metadata,
            welcome_email_pending: false,
          },
        });
        if (error) {
          throw error;
        }
      } catch (error) {
        if (active) {
          setAuthError(
            error instanceof Error
              ? `Welcome email could not be sent: ${error.message}`
              : "Welcome email could not be sent. Please try again.",
          );
        }
      }
    };

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setUser(session?.user ?? null);
        setAuthResolved(true);
        setAuthError("");
        if (session) {
          void sendPendingWelcome(session);
        }
      }
    });

    void authClient.auth.getSession().then(({ data, error }) => {
      if (!active) {
        return;
      }
      if (error) {
        setAuthError(error.message);
        setAuthResolved(true);
        return;
      }
      setUser(data.session?.user ?? null);
      setAuthResolved(true);
      if (data.session) {
        void sendPendingWelcome(data.session);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [authClient]);

  useEffect(() => {
    if (!authResolved) {
      return;
    }

    if (user) {
      if (!["/app", "/app/offline", "/app/profile"].includes(location.pathname)) {
        navigate("/app", { replace: true });
      }
      return;
    }

    if (location.pathname.startsWith("/app")) {
      setAuthMode("signin");
      setAuthOpen(true);
      navigate("/", { replace: true });
    } else if (location.pathname !== "/") {
      navigate("/", { replace: true });
    }
  }, [authResolved, location.pathname, navigate, user]);

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  function searchFromDashboard(query: string) {
    setSearchQuery(query);
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function scrollToSoundControls() {
    document.querySelector(".sound-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function toggleFavorite() {
    if (!onlineActiveTrack) {
      return;
    }
    toggleFavoriteTrack(onlineActiveTrack);
  }

  function toggleFavoriteTrack(track: Track) {
    setFavoriteTrackIds((favorites) =>
      favorites.includes(track.id)
        ? favorites.filter((id) => id !== track.id)
        : [...favorites, track.id],
    );
    setFavoriteTrackDetails((tracks) =>
      tracks.some((favorite) => favorite.id === track.id)
        ? tracks.filter((favorite) => favorite.id !== track.id)
        : [...tracks, track],
    );
  }

  function playMusicTrack(track: Track) {
    if (!user) {
      openAuth("signin");
      return;
    }
    if (track.source === "local") {
      navigate("/app/offline");
    } else {
      navigate("/app");
    }
    addToQueue(track);
    playTrack(track.id);
  }

  function addSearchResultToQueue(result: MusicSearchResult, play = false) {
    const track = searchedTracks.find((item) => item.id === `youtube-${result.id}`);
    if (!track) {
      return;
    }
    addToQueue(track);
    if (play) {
      if (!user) {
        openAuth("signin");
        return;
      }
      playTrack(track.id);
    }
    setSearchOpen(false);
  }

  async function importFiles(files: readonly File[]) {
    if (!user) {
      openAuth("signin");
      return;
    }
    if (files.length === 0) {
      return;
    }

    setLibraryBusy(true);
    setLibraryError("");
    try {
      const { added, failures } = await importAudioFiles(files);
      if (added.length > 0) {
        setLocalTracks(await listLocalTracks());
      }
      if (failures.length > 0) {
        setLibraryError(failures.join(" "));
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error
          ? `Files could not be added: ${error.message}`
          : "Files could not be added to your library.",
      );
    } finally {
      setLibraryBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function addLocalTrackToQueue(track: LocalAudioRecord) {
    addToQueue({
      id: track.id,
      localTrackId: track.id,
      title: track.title,
      artist: track.artist,
      source: "local",
      duration: track.duration,
      cover: "cover-orange",
    });
  }

  function playLocalTrack(track: LocalAudioRecord) {
    addLocalTrackToQueue(track);
    playTrack(track.id);
  }

  function playOfflineLibrary() {
    if (!user) {
      openAuth("signin");
      return;
    }
    if (localTracks.length === 0) {
      fileInputRef.current?.click();
      return;
    }
    localTracks.forEach(addLocalTrackToQueue);
    playTrack(localTracks[0].id);
  }

  function beginMetadataEdit(track: LocalAudioRecord) {
    setEditingTrack(track);
    setEditTitle(track.title);
    setEditArtist(track.artist);
    setEditAlbum(track.album);
    setMetadataError("");
  }

  async function saveMetadata() {
    if (!editingTrack || !editTitle.trim() || !editArtist.trim()) {
      setMetadataError("Track title and artist are required.");
      return;
    }

    setSavingMetadata(true);
    setMetadataError("");
    try {
      const updated = await saveLocalTrackMetadata(
        editingTrack.id,
        editTitle,
        editArtist,
        editAlbum,
      );
      setLocalTracks((tracks) =>
        tracks.map((track) => (track.id === updated.id ? updated : track)),
      );
      updateTrackMetadata(updated.id, updated.title, updated.artist);
      setFavoriteTrackDetails((tracks) =>
        tracks.map((track) =>
          track.id === updated.id
            ? { ...track, title: updated.title, artist: updated.artist }
            : track,
        ),
      );
      setEditingTrack(null);
    } catch (error) {
      setMetadataError(
        error instanceof Error
          ? error.message
          : "Metadata could not be saved.",
      );
    } finally {
      setSavingMetadata(false);
    }
  }

  async function deleteLocalTrack(track: LocalAudioRecord) {
    setLibraryError("");
    try {
      await removeLocalTrack(track.id);
      setLocalTracks((tracks) => tracks.filter((item) => item.id !== track.id));
      removeFromQueue(track.id);
      setFavoriteTrackIds((favorites) =>
        favorites.filter((id) => id !== track.id),
      );
      setFavoriteTrackDetails((tracks) =>
        tracks.filter((favorite) => favorite.id !== track.id),
      );
      if (editingTrack?.id === track.id) {
        setEditingTrack(null);
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error
          ? `Track could not be removed: ${error.message}`
          : "Track could not be removed from your library.",
      );
    }
  }

  async function handleSignOut() {
    if (!authClient) {
      return;
    }

    try {
      const { error } = await authClient.auth.signOut();
      if (error) {
        setAuthError(error.message);
        return;
      }
      setProfileMenuOpen(false);
      setUser(null);
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to sign out. Please try again.",
      );
    }
  }

  return (
    <main
      className={`app-shell min-h-screen ${user && hasPlayableSource(activeTrack) && activeTrack?.source === (currentView === "offline" ? "local" : "online") ? "has-persistent-player" : ""}`}
    >
      <svg className="svg-defs" aria-hidden="true">
        <defs>
          <linearGradient id="brand-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a45bff" />
            <stop offset="100%" stopColor="#00d2ff" />
          </linearGradient>
        </defs>
      </svg>
      <header className="topbar">
        <Link className="brand" to={user ? "/app" : "/"} aria-label="Tweak home">
          <BrandMark />
          <span>tweak<span className="brand-period">.</span></span>
        </Link>

        {currentView !== "offline" && (
        <div className="search-wrap" ref={searchContainerRef}>
          <label className="search-field">
            <Search size={17} />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search songs, artists, albums..."
              aria-label="Search songs, artists, and albums"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  event.currentTarget.blur();
                }
              }}
            />
            <kbd>⌘ K</kbd>
          </label>
          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className="search-results" role="region" aria-label="Music search results">
              <div className="search-results-heading">
                <span>Music discovery</span>
                <small>Music videos and official audio</small>
              </div>
              {searchLoading && (
                <p className="search-status" role="status">
                  <LoaderCircle size={15} className="search-spinner" /> Searching music…
                </p>
              )}
              {searchError && (
                <p className="search-status search-status-error" role="alert">
                  {searchError}
                </p>
              )}
              {!searchLoading && !searchError && searchResults.length === 0 && (
                <p className="search-status" role="status">
                  No matching tracks found. Try another search.
                </p>
              )}
              {searchResults.map((result) => {
                const queued = queue.some((track) => track.id === `youtube-${result.id}`);
                return (
                  <div className="search-result" key={result.id}>
                    {result.thumbnailUrl ? (
                      <img
                        className="search-result-art"
                        src={result.thumbnailUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="search-result-art search-result-art-fallback">
                        <Music2 size={16} />
                      </span>
                    )}
                    <span className="search-result-copy">
                      <strong>{result.title}</strong>
                      <small>{result.artist} · {formatTime(result.duration)}</small>
                    </span>
                    <span className="search-result-actions">
                      <button
                        type="button"
                        className="search-result-play"
                        onClick={() => addSearchResultToQueue(result, true)}
                        aria-label={`Play ${result.title}`}
                        title="Play"
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                      <button
                        type="button"
                        onClick={() => addSearchResultToQueue(result)}
                        disabled={queued}
                      >
                        <Plus size={13} /> {queued ? "Queued" : "Queue"}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        <div className="topbar-actions">
          <button
            className="icon-button theme-toggle"
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="utility-menu-wrap">
            <button
              className="icon-button notification-button"
              type="button"
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={18} />
            </button>
            {notificationsOpen && (
              <div className="utility-menu notification-popover" role="status">
                <strong>You’re all caught up</strong>
                <span>There are no new notifications.</span>
              </div>
            )}
          </div>
          {user ? (
            <div className="profile-menu-wrap">
              <button
                className="profile-button"
                type="button"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
              >
                <span className="avatar">{displayInitial}</span>
                <span className="profile-copy">
                  <strong>{displayName}</strong>
                  <small>Music listener</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {profileMenuOpen && (
                <div className="profile-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      navigate("/app/profile");
                    }}
                  >
                    <UserRound size={15} /> View profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      navigate("/app/offline");
                    }}
                  >
                    <CloudOff size={15} /> Offline library
                  </button>
                  <button type="button" onClick={handleSignOut}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              className="signin-nav-button"
              type="button"
              onClick={() => openAuth("signin")}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {user && (
        <nav className="music-navigation" aria-label="Music spaces">
          <NavLink
            to="/app"
            end
            className={({ isActive }) =>
              `music-navigation-link ${isActive ? "is-active" : ""}`
            }
          >
            <Headphones size={15} /> Listen
          </NavLink>
          <NavLink
            to="/app/offline"
            className={({ isActive }) =>
              `music-navigation-link ${isActive ? "is-active" : ""}`
            }
          >
            <CloudOff size={15} /> Offline library
          </NavLink>
          <NavLink
            to="/app/profile"
            className={({ isActive }) =>
              `music-navigation-link ${isActive ? "is-active" : ""}`
            }
          >
            <UserRound size={15} /> Profile
          </NavLink>
          <span className="music-navigation-spacer" />
          {currentView === "online" && (
            <NavLink className="go-offline-button" to="/app/offline">
              <ArrowDownToLine size={14} /> Go offline
            </NavLink>
          )}
        </nav>
      )}

      {authError && (
        <p className="auth-status" role="alert">
          {authError}
          <button type="button" onClick={() => setAuthError("")} aria-label="Dismiss error">
            ×
          </button>
        </p>
      )}

      <section className="welcome-row">
        <div>
          <p className="eyebrow welcome-eyebrow">
            {currentView === "offline"
              ? "ON THIS DEVICE ONLY"
              : currentView === "profile"
                ? "YOUR TWEAK ACCOUNT"
                : user
                  ? "YOUR SPACE, YOUR SOUND"
                  : "GUEST PREVIEW DASHBOARD"}
          </p>
          <h1>
            {currentView === "offline"
              ? "Your offline library"
              : currentView === "profile"
                ? "Your profile"
                : `Good evening, ${displayName}`}
            {currentView === "online" && <span> ✦</span>}
          </h1>
          <p className="welcome-copy">
            {currentView === "offline"
              ? "Only music files saved on this device appear here. Online discovery stays separate."
              : currentView === "profile"
                ? "Your account, saved music, and listening spaces in one place."
                : user
                  ? "A little more of what moves you."
                  : "Explore the hub. Sign in when you’re ready to listen."}
          </p>
        </div>
        {currentView === "offline" ? (
          <button
            className="customize-button"
            type="button"
            onClick={playOfflineLibrary}
          >
            {localTracks.length > 0
              ? <Play size={14} fill="currentColor" />
              : <Plus size={14} />}
            {localTracks.length > 0 ? "Play offline" : "Add music"}
          </button>
        ) : currentView === "profile" ? (
          <Link className="customize-button" to="/app">
            <Headphones size={14} /> Back to listening
          </Link>
        ) : user ? (
          <button className="customize-button" type="button" onClick={scrollToSoundControls}>
            <SlidersHorizontal size={15} /> Tune sound
          </button>
        ) : (
          <button
            className="customize-button"
            type="button"
            onClick={() => openAuth("signup")}
          >
            <LockKeyhole size={15} /> Sign up to unlock audio
          </button>
        )}
      </section>

      <section
        className={`dashboard-grid ${currentView === "offline" ? "offline-dashboard" : ""} ${currentView === "profile" ? "profile-dashboard" : ""}`}
        aria-label={
          currentView === "offline"
            ? "Offline music library"
            : currentView === "profile"
              ? "Listener profile"
              : user
                ? "Tweak music dashboard"
                : "Guest preview dashboard"
        }
      >
        {currentView === "online" && (
        <article className="panel discoveries-panel">
          <SectionTitle
            eyebrow="TUNED TO YOU"
            title={featuredOnlineTracks.length ? "Your next favorite" : "Find your frequency"}
            action={featuredOnlineTracks.length ? undefined : "Explore"}
            onAction={() => searchFromDashboard("new music")}
          />
          {featuredOnlineTracks.length > 0 ? (
            <div className="music-card-grid">
              {featuredOnlineTracks.map((track) => {
                const queued = onlineQueue.some((item) => item.id === track.id);
                const liked = favoriteTrackIds.includes(track.id);
                return (
                  <article className="music-card" key={track.id}>
                    <div className="music-card-art">
                      {track.artworkUrl ? (
                        <img src={track.artworkUrl} alt="" loading="lazy" />
                      ) : (
                        <span className={`music-card-fallback ${track.cover}`}>
                          <Music2 size={26} />
                        </span>
                      )}
                      <button
                        className="music-card-play"
                        type="button"
                        aria-label={`Play ${track.title}`}
                        onClick={() => playMusicTrack(track)}
                      >
                        <Play size={17} fill="currentColor" />
                      </button>
                    </div>
                    <div className="music-card-copy">
                      <strong title={track.title}>{track.title}</strong>
                      <small title={track.artist}>{track.artist}</small>
                      <div className="music-card-actions">
                        <button
                          type="button"
                          className={liked ? "is-favorite" : ""}
                          aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
                          aria-pressed={liked}
                          onClick={() => toggleFavoriteTrack(track)}
                        >
                          <Heart size={14} fill={liked ? "currentColor" : "none"} />
                          {liked ? "Saved" : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={queued}
                          aria-label={queued ? `${track.title} is in your queue` : `Add ${track.title} to queue`}
                          onClick={() => addToQueue(track)}
                        >
                          {queued ? <Check size={14} /> : <Plus size={14} />}
                          {queued ? "Queued" : "Queue"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="discovery-grid">
              {discoveries.map((item, index) => (
              <button
                className="discovery-card"
                type="button"
                key={item.title}
                onClick={() => searchFromDashboard(item.query)}
                title={`Search for ${item.title.toLowerCase()}`}
              >
                <span className={`discovery-art ${item.gradient}`}>
                  <span className="art-index">0{index + 1}</span>
                  {item.icon}
                  <span className="art-orbit" />
                </span>
                <span className="discovery-meta">
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <span className="round-arrow"><ArrowRight size={14} /></span>
              </button>
              ))}
            </div>
          )}
          <div className="discovery-footer">
            <span className="online-indicator" />
            {featuredOnlineTracks.length ? "Official music videos and audio" : "Fresh picks, updated for your mood"}
            <span className="footer-sparkle"><Sparkles size={14} /></span>
          </div>
        </article>
        )}

        {currentView === "offline" && (
        <article className="panel studio-panel">
          <div className="studio-heading">
            <div className="studio-icon"><Library size={19} /></div>
            <div className="utility-menu-wrap">
              <button
                className="more-button"
                type="button"
                aria-label="More studio options"
                aria-expanded={studioMenuOpen}
                onClick={() => setStudioMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={20} />
              </button>
              {studioMenuOpen && (
                <div className="utility-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setStudioMenuOpen(false);
                      if (user) {
                        fileInputRef.current?.click();
                      } else {
                        openAuth("signin");
                      }
                    }}
                  >
                    <Plus size={14} /> Import audio files
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStudioMenuOpen(false);
                      if (user) {
                        folderInputRef.current?.click();
                      } else {
                        openAuth("signin");
                      }
                    }}
                  >
                    <FolderOpen size={14} /> Scan a folder
                  </button>
                </div>
              )}
            </div>
          </div>
          <p className="eyebrow">YOUR COLLECTION</p>
          <h2>Music on this device</h2>
          <p className="studio-copy">
            Your imported MP3, FLAC, and WAV files stay in this browser on this device.
          </p>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".mp3,.flac,.wav,audio/mpeg,audio/flac,audio/wav"
            multiple
            tabIndex={-1}
            aria-label="Choose local audio files"
            onChange={(event) => {
              void importFiles(Array.from(event.currentTarget.files ?? []));
            }}
          />
          <input
            ref={folderInputRef}
            className="visually-hidden"
            type="file"
            accept=".mp3,.flac,.wav,audio/mpeg,audio/flac,audio/wav"
            multiple
            tabIndex={-1}
            aria-label="Choose a folder of local audio files"
            onChange={(event) => {
              void importFiles(Array.from(event.currentTarget.files ?? []));
            }}
          />
          <button
            className={`dropzone ${libraryDragging ? "is-dragging" : ""}`}
            type="button"
            disabled={libraryBusy}
            onClick={() => {
              if (user) {
                fileInputRef.current?.click();
              } else {
                openAuth("signin");
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (user) {
                setLibraryDragging(true);
              }
            }}
            onDragLeave={() => setLibraryDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setLibraryDragging(false);
              void importFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <span className="dropzone-icon"><ArrowDownToLine size={17} /></span>
            <span>
              <strong>{libraryBusy ? "Reading your music…" : "Bring your music in"}</strong>
              <small>
                {user
                  ? "Drop MP3, FLAC, or WAV files here or browse"
                  : "Sign in to import files from this device"}
              </small>
            </span>
            {libraryBusy ? (
              <LoaderCircle className="dropzone-plus search-spinner" size={18} />
            ) : (
              <Plus className="dropzone-plus" size={18} />
            )}
          </button>
          <button
            className="folder-scan-button"
            type="button"
            disabled={libraryBusy}
            onClick={() => {
              if (user) {
                folderInputRef.current?.click();
              } else {
                openAuth("signin");
              }
            }}
          >
            <FolderOpen size={13} /> Scan a folder
          </button>
          {libraryError && <p className="library-error" role="alert">{libraryError}</p>}
          <div className="local-library-list" aria-label="Local music library">
            {!user ? (
              <p className="library-empty">Sign in to view your local library.</p>
            ) : libraryLoading ? (
              <p className="library-empty">Loading your saved library…</p>
            ) : localTracks.length === 0 ? (
              <p className="library-empty">No local tracks saved yet.</p>
            ) : (
              localTracks.map((track) => {
                const queued = queue.some((item) => item.id === track.id);
                return (
                  <div className="local-library-row" key={track.id}>
                    <button
                      type="button"
                      className="library-action local-library-play"
                      aria-label={`Play ${track.title} offline`}
                      onClick={() => playLocalTrack(track)}
                    >
                      <Play size={13} fill="currentColor" />
                    </button>
                    <span className="local-library-copy">
                      <strong>{track.title}</strong>
                      <small>
                        {track.artist}
                        {track.album ? ` · ${track.album}` : ""}
                        {" · "}{formatTime(track.duration)}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="library-action"
                      disabled={queued}
                      aria-label={queued ? `${track.title} is queued` : `Add ${track.title} to queue`}
                      title={queued ? "Already in queue" : "Add to queue"}
                      onClick={() => addLocalTrackToQueue(track)}
                    >
                      {queued ? <Check size={14} /> : <Plus size={14} />}
                    </button>
                    <button
                      type="button"
                      className={`library-action ${favoriteTrackIds.includes(track.id) ? "is-favorite" : ""}`}
                      aria-label={favoriteTrackIds.includes(track.id) ? `Remove ${track.title} from saved music` : `Save ${track.title}`}
                      title={favoriteTrackIds.includes(track.id) ? "Remove from saved music" : "Save track"}
                      onClick={() =>
                        toggleFavoriteTrack({
                          id: track.id,
                          title: track.title,
                          artist: track.artist,
                          source: "local",
                          duration: track.duration,
                          cover: "cover-orange",
                          localTrackId: track.id,
                        })
                      }
                    >
                      <Heart
                        size={13}
                        fill={favoriteTrackIds.includes(track.id) ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      type="button"
                      className="library-action"
                      aria-label={`Edit metadata for ${track.title}`}
                      title="Edit library metadata"
                      onClick={() => beginMetadataEdit(track)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="library-action library-remove"
                      aria-label={`Remove ${track.title} from library`}
                      title="Remove from library"
                      onClick={() => void deleteLocalTrack(track)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="studio-stats">
            <span><Disc3 size={15} /> <strong>{user ? localTracks.length : 0}</strong> tracks</span>
            <span className="stat-divider" />
            <span><CloudOff size={15} /> Stored on this device</span>
          </div>
        </article>
        )}

        {currentView === "online" && (
        <article className="panel player-panel">
          <div className="player-topline">
            <div className="player-label">
              <span className="live-dot" />
              {user ? "NOW IN YOUR MIX" : "PREVIEW PLAYER"}
            </div>
            <div className="utility-menu-wrap">
              <button
                className="more-button"
                type="button"
                aria-label="More player options"
                aria-expanded={playerMenuOpen}
                onClick={() => setPlayerMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={20} />
              </button>
              {playerMenuOpen && (
                <div className="utility-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerMenuOpen(false);
                      scrollToSoundControls();
                    }}
                  >
                    <SlidersHorizontal size={14} /> Open sound controls
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="player-content">
            <div className="album-art">
              <div className="album-sun" />
              <div className="album-horizon" />
              <span className="album-label">TWEAK<br />SESSIONS</span>
              <span className="album-number">VOL. 01</span>
            </div>
            <div className="track-info">
              <p className="eyebrow">SUGGESTED FOR YOU</p>
              <h2>{onlineActiveTrack?.title ?? "Nothing queued"}</h2>
              <p className="track-artist">
                {onlineActiveTrack?.artist ?? "Add a track to your queue"}
              </p>
              <SpectrumVisualizer />
              <input
                className="seek-slider"
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration)}
                aria-label="Seek through current track"
                disabled={!canPlay || !isReady || duration <= 0}
                style={{
                  background: `linear-gradient(90deg, var(--purple) 0%, var(--blue) ${visualProgress * 100}%, var(--line-strong) ${visualProgress * 100}%, var(--line-strong) 100%)`,
                }}
                onChange={(event) => seekTo(Number(event.target.value))}
              />
              <div className="track-timing">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>
          <div className="player-controls">
            <span className="source-pill">
              <Cloud size={12} />
              {onlineActiveTrack?.source.toUpperCase() ?? "QUEUE"}
            </span>
            <div className="transport">
              <button
                type="button"
                className="transport-button"
                aria-label="Previous track"
                disabled={!canPlay}
                onClick={previousTrack}
              >
                <ArrowLeft size={17} />
              </button>
              <button
                type="button"
                className="play-button"
                aria-label={isPlaying ? "Pause playback" : "Play preview"}
                disabled={!canPlay}
                onClick={togglePlayback}
              >
                {isPlaying
                  ? <Pause size={16} fill="currentColor" />
                  : <Play size={16} fill="currentColor" />}
              </button>
              <button
                type="button"
                className="transport-button"
                aria-label="Next track"
                disabled={!canPlay || activeQueueIndex >= onlineQueue.length - 1}
                onClick={nextTrack}
              >
                <ArrowRight size={17} />
              </button>
            </div>
            <label className="volume-control">
              <Volume2 size={14} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                aria-label="Volume"
                style={{
                  background: `linear-gradient(90deg, var(--purple) ${volume * 100}%, var(--line-strong) ${volume * 100}%)`,
                }}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>
            <button
              className={`icon-button like-button ${onlineActiveTrack && favoriteTrackIds.includes(onlineActiveTrack.id) ? "is-favorite" : ""}`}
              type="button"
              aria-label={onlineActiveTrack && favoriteTrackIds.includes(onlineActiveTrack.id) ? "Unlike track" : "Like track"}
              aria-pressed={Boolean(onlineActiveTrack && favoriteTrackIds.includes(onlineActiveTrack.id))}
              disabled={!onlineActiveTrack}
              onClick={toggleFavorite}
              title={onlineActiveTrack && favoriteTrackIds.includes(onlineActiveTrack.id) ? "Remove from favorites" : "Add to favorites"}
            >
              <Heart size={17} fill={onlineActiveTrack && favoriteTrackIds.includes(onlineActiveTrack.id) ? "currentColor" : "none"} />
            </button>
          </div>
          {playbackError && <p className="player-error" role="alert">{playbackError}</p>}
          {user ? (
            <div className="member-player-note">
              {hasPlayableSource(onlineActiveTrack)
                ? "Playback is ready."
                : "Add a playable local file or online stream to listen."}
            </div>
          ) : (
            <div className="playback-gate">
              <span className="gate-lock"><LockKeyhole size={14} /></span>
              <span className="gate-copy">
                <strong>Guest preview</strong>
                <small>Sign in to unlock audio playback</small>
              </span>
              <button type="button" onClick={() => openAuth("signin")}>
                Sign in <ArrowRight size={13} />
              </button>
            </div>
          )}
        </article>
        )}

        {currentView === "online" && (
        <article className="panel sound-panel">
          <SectionTitle eyebrow="MAKE IT YOURS" title="Sound, shaped by you" />
          <div className="sound-feature">
            <span className="sound-icon"><AudioWaveform size={17} /></span>
            <div className="sound-feature-copy">
              <strong>Studio equalizer</strong>
              <small>10 bands · real-time processing</small>
            </div>
            <span className={`audio-engine-status ${isReady ? "is-ready" : ""}`}>
              {isReady ? "LIVE" : "READY"}
            </span>
          </div>
          <div className="eq-controls" aria-label="10-band equalizer">
            {equalizerGains.map((gain, index) => (
              <label className="eq-band" key={eqBandLabels[index]}>
                <span className="eq-band-gain">{gain > 0 ? "+" : ""}{gain}</span>
                <input
                  className="eq-band-slider"
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={gain}
                  disabled={!user}
                  aria-label={`${eqBandLabels[index]} Hz equalizer gain`}
                  aria-valuetext={`${gain} decibels`}
                  onChange={(event) =>
                    setEqualizerGain(index, Number(event.target.value))
                  }
                />
                <span className="eq-band-label">{eqBandLabels[index]}</span>
              </label>
            ))}
          </div>
          <div className="sound-range-controls">
            <label className="sound-range-row">
              <span><Volume2 size={13} /> Bass boost</span>
              <input
                className="sound-range"
                type="range"
                min={0}
                max={12}
                step={1}
                value={bassBoost}
                disabled={!user}
                aria-label="Bass boost gain"
                onChange={(event) => setBassBoost(Number(event.target.value))}
              />
              <output>{bassBoost} dB</output>
            </label>
            <label className="sound-range-row">
              <span><Waves size={13} /> Crossfade</span>
              <input
                className="sound-range"
                type="range"
                min={0}
                max={12}
                step={1}
                value={crossfadeSeconds}
                disabled={!user}
                aria-label="Crossfade duration"
                onChange={(event) =>
                  setCrossfadeSeconds(Number(event.target.value))
                }
              />
              <output>{crossfadeSeconds === 0 ? "Off" : `${crossfadeSeconds}s`}</output>
            </label>
            <label className="normalizer-toggle">
              <span><AudioLines size={13} /> Volume normalizer</span>
              <input
                type="checkbox"
                checked={normalizerEnabled}
                disabled={!user}
                onChange={(event) => setNormalizerEnabled(event.target.checked)}
              />
            </label>
          </div>
          {!user && <p className="sound-guest-note">Sign in to unlock sound controls.</p>}
          {crossfadeWarning && (
            <p className="sound-processing-warning" role="status">
              {crossfadeWarning}
            </p>
          )}
        </article>
        )}

        {currentView === "online" && (
        <article className="panel queue-panel">
          <div className="queue-heading">
            <SectionTitle eyebrow="YOUR NEXT LISTEN" title="Up next" />
            <button
              className="queue-add"
              type="button"
              onClick={() => searchFromDashboard("")}
            >
              <Plus size={15} /> Add music
            </button>
          </div>
          <div className="queue-table">
            <div className="queue-row queue-header">
              <span>#</span><span>TRACK</span><span>SOURCE</span><span>TIME</span><span />
            </div>
            {visibleQueue.length === 0 ? (
              <p className="queue-empty" role="status">
                Your online queue is empty. Search for music and add a track to get started.
              </p>
            ) : visibleQueue.map((track, index) => (
              <div
                className={`queue-row ${track.id === activeTrackId ? "is-active" : ""}`}
                key={track.id}
              >
                <span className="queue-number">{index + 1}</span>
                <span className="queue-track">
                  <span className={`track-cover ${track.cover}`}>
                    {track.artworkUrl ? (
                      <img src={track.artworkUrl} alt="" loading="lazy" />
                    ) : (
                      <Music2 size={14} />
                    )}
                  </span>
                  <span><strong>{track.title}</strong><small>{track.artist}</small></span>
                </span>
                <span><span className={`queue-source ${track.source.toLowerCase()}`}>
                  {track.source === "online" ? <Cloud size={11} /> : <ArrowDownToLine size={11} />}
                  {track.source.toUpperCase()}
                </span></span>
                <span className="queue-time">{formatTime(track.duration)}</span>
                <span className="queue-actions">
                  <button
                    className="queue-more queue-play"
                    type="button"
                    aria-label={`Play ${track.title}`}
                    disabled={!user || !hasPlayableSource(track)}
                    onClick={() => playTrack(track.id)}
                  >
                    <Play size={13} fill="currentColor" />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="queue-footer">
            <span><Cloud size={14} /> Online music queue</span>
            <button
              className="text-button"
              type="button"
              disabled={visibleQueue.length === 0}
              onClick={() => clearQueueForSource("online")}
            >
              Clear queue <Trash2 size={13} />
            </button>
          </div>
        </article>
        )}

        {currentView === "offline" && offlineQueue.length > 0 && (
          <article className="panel queue-panel offline-queue-panel">
            <div className="queue-heading">
              <SectionTitle eyebrow="SAVED ON THIS DEVICE" title="Offline play queue" />
              <button
                className="queue-add"
                type="button"
                onClick={playOfflineLibrary}
              >
                <Play size={14} fill="currentColor" /> Play all
              </button>
            </div>
            <div className="offline-track-list">
              {offlineQueue.map((track, index) => (
                <button
                  className={`offline-track-row ${track.id === activeTrackId ? "is-active" : ""}`}
                  key={track.id}
                  type="button"
                  onClick={() => playTrack(track.id)}
                >
                  <span>{index + 1}</span>
                  <span className="offline-track-copy">
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                  <span>{formatTime(track.duration)}</span>
                  {track.id === activeTrackId && isPlaying
                    ? <Pause size={15} />
                    : <Play size={14} />}
                </button>
              ))}
            </div>
          </article>
        )}

        {currentView === "profile" && user && (
          <section className="profile-content">
            <article className="panel profile-overview">
              <div className="profile-hero">
                <span className="profile-avatar-large">{displayInitial}</span>
                <div>
                  <p className="eyebrow">LISTENER PROFILE</p>
                  <h2>{displayName}</h2>
                  <p>{user.email ?? "Email not available"}</p>
                </div>
                <button
                  className="profile-signout"
                  type="button"
                  onClick={() => void handleSignOut()}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
              <div className="profile-stats">
                <div><strong>{favoriteTrackIds.length}</strong><span>Saved tracks</span></div>
                <div><strong>{onlineQueue.length}</strong><span>Online queue</span></div>
                <div><strong>{localTracks.length}</strong><span>Offline tracks</span></div>
              </div>
            </article>

            <div className="profile-content-grid">
              <article className="panel profile-details">
                <p className="eyebrow">ACCOUNT DETAILS</p>
                <h2>Your account</h2>
                <dl>
                  <div><dt>Display name</dt><dd>{displayName}</dd></div>
                  <div><dt>Email</dt><dd>{user.email ?? "Not available"}</dd></div>
                  <div><dt>Member since</dt><dd>{new Date(user.created_at).toLocaleDateString()}</dd></div>
                  <div><dt>Listening mode</dt><dd>Online discovery + device library</dd></div>
                </dl>
                <p className="profile-privacy-note">
                  <ShieldCheck size={15} />
                  Your imported audio stays in this browser; it is not uploaded to Tweak.
                </p>
              </article>

              <article className="panel profile-saved">
                <div className="profile-saved-heading">
                  <div>
                    <p className="eyebrow">YOUR COLLECTION</p>
                    <h2>Saved music</h2>
                  </div>
                  <Heart size={17} />
                </div>
                {savedTracks.length === 0 ? (
                  <div className="profile-empty">
                    <Heart size={21} />
                    <p>No saved tracks yet.</p>
                    <Link to="/app">Explore music and tap Save on a track.</Link>
                  </div>
                ) : (
                  <div className="profile-saved-list">
                    {savedTracks.map((track) => (
                      <div className="profile-saved-row" key={track.id}>
                        {track.artworkUrl ? (
                          <img src={track.artworkUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="profile-saved-art"><Music2 size={15} /></span>
                        )}
                        <span><strong>{track.title}</strong><small>{track.artist}</small></span>
                        <button
                          type="button"
                          aria-label={`Play ${track.title}`}
                          onClick={() => playMusicTrack(track)}
                        >
                          <Play size={14} fill="currentColor" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${track.title} from saved music`}
                          onClick={() => toggleFavoriteTrack(track)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </div>

            <div className="profile-shortcuts">
              <Link to="/app"><Headphones size={16} /><span><strong>Listen online</strong><small>Search for music videos and audio</small></span><ArrowRight size={15} /></Link>
              <Link to="/app/offline"><CloudOff size={16} /><span><strong>Offline library</strong><small>Play files stored on this device</small></span><ArrowRight size={15} /></Link>
            </div>
          </section>
        )}
      </section>

      {currentView !== "offline" && (
      <footer className="page-footer">
        <span><BrandMark /> A calmer way to listen.</span>
        <span><Check size={13} /> Your music. Your rules.</span>
      </footer>
      )}
      <AudioEngine />
      {editingTrack && (
        <div className="metadata-dialog-backdrop">
          <section
            className="metadata-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="metadata-dialog-title"
          >
            <div className="metadata-dialog-heading">
              <div>
                <p className="eyebrow">LOCAL LIBRARY</p>
                <h2 id="metadata-dialog-title">Edit track details</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close metadata editor"
                onClick={() => setEditingTrack(null)}
              >
                <X size={17} />
              </button>
            </div>
            <p className="metadata-dialog-note">
              These edits are saved in Tweak; your original audio file is not changed.
            </p>
            <label>
              Track title
              <input
                autoFocus
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                maxLength={160}
              />
            </label>
            <label>
            Album
            <input
              value={editAlbum}
              onChange={(event) => setEditAlbum(event.target.value)}
              maxLength={160}
            />
            </label>
            {metadataError && (
            <p className="metadata-error" role="alert">{metadataError}</p>
            )}
            <label>
              Artist
              <input
                value={editArtist}
                onChange={(event) => setEditArtist(event.target.value)}
                maxLength={160}
              />
            </label>
            <div className="metadata-dialog-actions">
              <button type="button" onClick={() => setEditingTrack(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="metadata-save"
                disabled={savingMetadata}
                onClick={() => void saveMetadata()}
              >
                {savingMetadata ? "Saving…" : "Save details"}
              </button>
            </div>
          </section>
        </div>
      )}
      {authOpen && (
        <AuthModal
          initialMode={authMode}
          onAuthClientChanged={setAuthClient}
          onClose={() => setAuthOpen(false)}
        />
      )}
    </main>
  );
}

export default App;
