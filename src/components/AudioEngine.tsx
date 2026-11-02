import { useEffect, useRef, useState } from "react";
import { getLocalTrack } from "../lib/localLibrary";
import {
  applyAudioSettings,
  getOrCreateAudioGraph,
  scheduleDeckCrossfade,
  setDeckGain,
  type AudioGraph,
} from "../lib/audioGraph";
import {
  hasNativeAudioSource,
  useAudioStore,
} from "../stores/audioStore";
import type { Track } from "../stores/audioStore";
import PlaybackBar from "./PlaybackBar";

type Deck = 0 | 1;
type AudioElements = [HTMLAudioElement | null, HTMLAudioElement | null];
type CrossfadeTransition = {
  from: Deck;
  to: Deck;
  trackId: string;
  timer: number | null;
};

function otherDeck(deck: Deck): Deck {
  return deck === 0 ? 1 : 0;
}

function releaseDeck(
  audio: HTMLAudioElement,
  deck: Deck,
  objectUrls: [string | null, string | null],
): void {
  audio.pause();
  audio.removeAttribute("src");
  audio.dataset.trackId = "";
  audio.load();
  const objectUrl = objectUrls[deck];
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrls[deck] = null;
  }
}

async function resolveTrackSource(
  track: Track,
): Promise<{ source: string; objectUrl: string | null }> {
  if (track.audioUrl) {
    return { source: track.audioUrl, objectUrl: null };
  }
  if (track.source === "local" && track.localTrackId) {
    const storedTrack = await getLocalTrack(track.localTrackId);
    if (!storedTrack) {
      throw new Error("This local audio file is missing from your library.");
    }
    const objectUrl = URL.createObjectURL(storedTrack.file);
    return { source: objectUrl, objectUrl };
  }
  throw new Error("This track does not have a playable audio source.");
}

function AudioEngine() {
  const audioRefs = [
    useRef<HTMLAudioElement>(null),
    useRef<HTMLAudioElement>(null),
  ] as const;
  const [activeDeck, setActiveDeck] = useState<Deck>(0);
  const activeDeckRef = useRef<Deck>(0);
  const audioGraphRef = useRef<AudioGraph | null>(null);
  const objectUrlsRef = useRef<[string | null, string | null]>([null, null]);
  const preparedTrackIdRef = useRef<string | null>(null);
  const transitionRef = useRef<CrossfadeTransition | null>(null);
  const activeTrackId = useAudioStore((state) => state.activeTrackId);
  const queue = useAudioStore((state) => state.queue);
  const track = queue.find((item) => item.id === activeTrackId);
  const isPlaying = useAudioStore((state) => state.isPlaying);
  const isAuthenticated = useAudioStore((state) => state.isAuthenticated);
  const isReady = useAudioStore((state) => state.isReady);
  const volume = useAudioStore((state) => state.volume);
  const equalizerGains = useAudioStore((state) => state.equalizerGains);
  const bassBoost = useAudioStore((state) => state.bassBoost);
  const crossfadeSeconds = useAudioStore((state) => state.crossfadeSeconds);
  const normalizerEnabled = useAudioStore((state) => state.normalizerEnabled);
  const seekSequence = useAudioStore((state) => state.seekSequence);
  const setCurrentTime = useAudioStore((state) => state.setCurrentTime);
  const setDuration = useAudioStore((state) => state.setDuration);
  const setReady = useAudioStore((state) => state.setReady);
  const setPlaybackError = useAudioStore((state) => state.setPlaybackError);
  const setCrossfadeWarning = useAudioStore((state) => state.setCrossfadeWarning);

  function getAudioElements(): AudioElements {
    return [audioRefs[0].current, audioRefs[1].current];
  }

  function cancelCrossfade(): void {
    const transition = transitionRef.current;
    if (transition?.timer !== null && transition?.timer !== undefined) {
      window.clearTimeout(transition.timer);
    }
    transitionRef.current = null;
    const active = activeDeckRef.current;
    const standby = otherDeck(active);
    const standbyAudio = audioRefs[standby].current;
    standbyAudio?.pause();
    const graph = audioGraphRef.current;
    if (graph) {
      setDeckGain(graph, active, 1);
      setDeckGain(graph, standby, 0);
    }
  }

  async function prepareNextTrack(): Promise<void> {
    const state = useAudioStore.getState();
    const activeIndex = state.queue.findIndex((item) => item.id === state.activeTrackId);
    const nextTrack = state.queue[activeIndex + 1];
    const currentTrack = state.queue[activeIndex];
    const fadeLength = Math.min(state.crossfadeSeconds, state.duration / 2);
    const prepareAt = Math.max(0, state.duration - fadeLength - 5);
    const standbyDeck = otherDeck(activeDeckRef.current);
    const standbyAudio = audioRefs[standbyDeck].current;

    if (
      !currentTrack ||
      !nextTrack ||
      !hasNativeAudioSource(nextTrack) ||
      !state.isAuthenticated ||
      !state.isPlaying ||
      fadeLength <= 0 ||
      state.duration <= 0 ||
      state.currentTime < prepareAt ||
      !standbyAudio
    ) {
      return;
    }
    if (
      standbyAudio.dataset.trackId === nextTrack.id ||
      preparedTrackIdRef.current === nextTrack.id
    ) {
      return;
    }

    preparedTrackIdRef.current = nextTrack.id;
    let objectUrl: string | null = null;
    try {
      const { source, objectUrl: resolvedObjectUrl } =
        await resolveTrackSource(nextTrack);
      objectUrl = resolvedObjectUrl;
      const latest = useAudioStore.getState();
      const latestIndex = latest.queue.findIndex(
        (item) => item.id === latest.activeTrackId,
      );
      if (
        latest.activeTrackId !== currentTrack.id ||
        latest.queue[latestIndex + 1]?.id !== nextTrack.id ||
        !latest.isPlaying
      ) {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        return;
      }

      releaseDeck(standbyAudio, standbyDeck, objectUrlsRef.current);
      standbyAudio.dataset.trackId = nextTrack.id;
      standbyAudio.volume = 1;
      objectUrlsRef.current[standbyDeck] = objectUrl;
      const graph = audioGraphRef.current;
      if (graph) {
        setDeckGain(graph, standbyDeck, 0);
      }
      standbyAudio.src = source;
      standbyAudio.load();
    } catch (error) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      preparedTrackIdRef.current = null;
      console.error("Tweak could not preload the next track for crossfade.", error);
      setCrossfadeWarning(
        error instanceof Error
          ? `Crossfade unavailable: ${error.message}`
          : "Crossfade unavailable for the next track.",
      );
    }
  }

  function startCrossfade(): void {
    if (transitionRef.current) {
      return;
    }
    const state = useAudioStore.getState();
    const activeIndex = state.queue.findIndex((item) => item.id === state.activeTrackId);
    const nextTrack = state.queue[activeIndex + 1];
    const currentTrack = state.queue[activeIndex];
    const from = activeDeckRef.current;
    const to = otherDeck(from);
    const nextAudio = audioRefs[to].current;
    const graph = audioGraphRef.current;
    const remaining = state.duration - state.currentTime;
    const fadeLength = Math.min(
      state.crossfadeSeconds,
      state.duration / 2,
      remaining,
    );

    if (
      !state.isAuthenticated ||
      !state.isPlaying ||
      !currentTrack ||
      !nextTrack ||
      !nextAudio ||
      !graph ||
      fadeLength <= 0 ||
      state.currentTime < state.duration - Math.min(state.crossfadeSeconds, state.duration / 2) ||
      nextAudio.dataset.trackId !== nextTrack.id ||
      nextAudio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    const transition: CrossfadeTransition = {
      from,
      to,
      trackId: currentTrack.id,
      timer: null,
    };
    transitionRef.current = transition;

    void graph.context.resume().then(async () => {
      const latest = useAudioStore.getState();
      if (
        transitionRef.current !== transition ||
        !latest.isPlaying ||
        latest.activeTrackId !== transition.trackId
      ) {
        return;
      }
      nextAudio.currentTime = 0;
      await nextAudio.play();
      if (transitionRef.current !== transition) {
        nextAudio.pause();
        return;
      }

      setCrossfadeWarning(null);
      scheduleDeckCrossfade(graph, from, to, fadeLength);
      transition.timer = window.setTimeout(() => {
        if (transitionRef.current !== transition) {
          return;
        }
        const currentState = useAudioStore.getState();
        if (
          !currentState.isPlaying ||
          currentState.activeTrackId !== transition.trackId
        ) {
          cancelCrossfade();
          return;
        }

        transitionRef.current = null;
        setDeckGain(graph, from, 0);
        setDeckGain(graph, to, 1);
        activeDeckRef.current = to;
        setActiveDeck(to);
        const nextPosition = nextAudio.currentTime;
        useAudioStore.getState().next();
        useAudioStore.getState().setCurrentTime(nextPosition);
      }, fadeLength * 1000);
    }).catch((error: unknown) => {
      if (transitionRef.current === transition) {
        transitionRef.current = null;
        setDeckGain(graph, from, 1);
        setDeckGain(graph, to, 0);
        nextAudio.pause();
        setCrossfadeWarning(
          error instanceof Error
            ? `Crossfade unavailable: ${error.message}`
            : "Crossfade could not start.",
        );
      }
    });
  }

  function handleTimeUpdate(deck: Deck, audio: HTMLAudioElement): void {
    if (deck !== activeDeckRef.current) {
      return;
    }
    setCurrentTime(audio.currentTime);
    void prepareNextTrack();
    startCrossfade();
  }

  useEffect(() => {
    const audio = audioRefs[activeDeck].current;
    if (!audio) {
      return;
    }

    const standbyDeck = otherDeck(activeDeck);
    const standbyAudio = audioRefs[standbyDeck].current;
    let cancelled = false;
    const activeAudio = audio;
    const currentTrack = track;

    if (transitionRef.current) {
      cancelCrossfade();
    }

    const alreadyPrepared =
      currentTrack &&
      hasNativeAudioSource(currentTrack) &&
      activeAudio.dataset.trackId === currentTrack.id;
    if (alreadyPrepared) {
      if (standbyAudio) {
        releaseDeck(standbyAudio, standbyDeck, objectUrlsRef.current);
      }
      preparedTrackIdRef.current = null;
      if (activeAudio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        setDuration(activeAudio.duration);
        setReady(true);
      }
      const graph = audioGraphRef.current;
      if (graph) {
        setDeckGain(graph, activeDeck, 1);
        setDeckGain(graph, standbyDeck, 0);
      }
      return () => {
        cancelled = true;
      };
    }

    releaseDeck(activeAudio, activeDeck, objectUrlsRef.current);
    if (standbyAudio) {
      releaseDeck(standbyAudio, standbyDeck, objectUrlsRef.current);
    }
    preparedTrackIdRef.current = null;
    setReady(false);
    const graph = audioGraphRef.current;
    if (graph) {
      setDeckGain(graph, activeDeck, 1);
      setDeckGain(graph, standbyDeck, 0);
    }

    const loadActiveSource = async () => {
      if (!currentTrack || !hasNativeAudioSource(currentTrack)) {
        return;
      }
      const { source, objectUrl } = await resolveTrackSource(currentTrack);
      if (cancelled) {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        return;
      }
      objectUrlsRef.current[activeDeck] = objectUrl;
      activeAudio.dataset.trackId = currentTrack.id;
      activeAudio.volume = 1;
      activeAudio.src = source;
      activeAudio.load();
    };

    void loadActiveSource().catch((error: unknown) => {
      if (!cancelled) {
        setPlaybackError(
          error instanceof Error ? error.message : "The track could not be loaded.",
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeDeck,
    activeTrackId,
    setDuration,
    setPlaybackError,
    setReady,
    track?.audioUrl,
    track?.localTrackId,
    track?.source,
  ]);

  useEffect(() => {
    const elements = getAudioElements();
    const activeAudio = elements[activeDeck];
    const standbyAudio = elements[otherDeck(activeDeck)];
    if (!activeAudio || !standbyAudio) {
      return;
    }

    if (!hasNativeAudioSource(track)) {
      activeAudio.pause();
      standbyAudio.pause();
      return;
    }

    if (!isAuthenticated || !isPlaying) {
      activeAudio.pause();
      standbyAudio.pause();
      if (transitionRef.current) {
        cancelCrossfade();
      }
      return;
    }
    if (!isReady) {
      return;
    }

    try {
      const graph = getOrCreateAudioGraph([activeAudio, standbyAudio]);
      audioGraphRef.current = graph;
      applyAudioSettings(
        graph,
        equalizerGains,
        bassBoost,
        normalizerEnabled,
        volume,
      );
      activeAudio.volume = 1;
      standbyAudio.volume = 1;
      void graph.context.resume().then(() => {
        const latest = useAudioStore.getState();
        if (
          latest.isPlaying &&
          latest.activeTrackId === activeTrackId &&
          activeDeckRef.current === activeDeck
        ) {
          void activeAudio.play().catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            setPlaybackError(
              error instanceof Error ? error.message : "The track could not be played.",
            );
          });
        }
      }).catch((error: unknown) => {
        setPlaybackError(
          error instanceof Error
            ? `Audio processing could not start: ${error.message}`
            : "Audio processing could not start.",
        );
      });
    } catch (error) {
      setPlaybackError(
        error instanceof Error
          ? `Audio processing could not start: ${error.message}`
          : "Audio processing could not start.",
      );
    }
  }, [
    activeDeck,
    activeTrackId,
    bassBoost,
    equalizerGains,
    isAuthenticated,
    isPlaying,
    isReady,
    normalizerEnabled,
    setPlaybackError,
    volume,
  ]);

  useEffect(() => {
    const graph = audioGraphRef.current;
    if (graph) {
      applyAudioSettings(
        graph,
        equalizerGains,
        bassBoost,
        normalizerEnabled,
        volume,
      );
    }
  }, [bassBoost, equalizerGains, normalizerEnabled, volume]);

  useEffect(() => {
    if (crossfadeSeconds === 0) {
      if (transitionRef.current) {
        cancelCrossfade();
      }
      const standby = audioRefs[otherDeck(activeDeckRef.current)].current;
      if (standby) {
        releaseDeck(standby, otherDeck(activeDeckRef.current), objectUrlsRef.current);
      }
      preparedTrackIdRef.current = null;
      setCrossfadeWarning(null);
    }
  }, [crossfadeSeconds, setCrossfadeWarning]);

  useEffect(() => {
    if (!hasNativeAudioSource(track) || !isAuthenticated || !isReady) {
      return;
    }
    const audio = audioRefs[activeDeck].current;
    if (!audio) {
      return;
    }
    try {
      audio.currentTime = Math.min(
        useAudioStore.getState().currentTime,
        audio.duration,
      );
    } catch (error) {
      setPlaybackError(
        error instanceof Error ? error.message : "The track could not be seeked.",
      );
    }
  }, [
    activeDeck,
    activeTrackId,
    isAuthenticated,
    isReady,
    seekSequence,
    setPlaybackError,
    track?.audioUrl,
    track?.localTrackId,
  ]);

  useEffect(
    () => () => {
      const transition = transitionRef.current;
      if (transition?.timer !== null && transition?.timer !== undefined) {
        window.clearTimeout(transition.timer);
      }
      const elements = getAudioElements();
      ([0, 1] as const).forEach((deck) => {
        const audio = elements[deck];
        if (audio) {
          releaseDeck(audio, deck, objectUrlsRef.current);
        }
      });
    },
    [],
  );

  function handleLoadedMetadata(deck: Deck, audio: HTMLAudioElement): void {
    const state = useAudioStore.getState();
    if (
      deck === activeDeckRef.current &&
      hasNativeAudioSource(track) &&
      audio.dataset.trackId === state.activeTrackId &&
      audio.currentSrc
    ) {
      setDuration(audio.duration);
      setReady(true);
    }
  }

  function handleEnded(deck: Deck): void {
    if (deck === activeDeckRef.current && !transitionRef.current) {
      useAudioStore.getState().next();
    }
  }

  function handleAudioError(deck: Deck, audio: HTMLAudioElement): void {
    if (
      deck === activeDeckRef.current &&
      hasNativeAudioSource(track) &&
      audio.currentSrc
    ) {
      setReady(false);
      setPlaybackError("The audio source could not be loaded.");
    }
  }

  const decks: readonly Deck[] = [0, 1];
  return (
    <>
      <PlaybackBar />
      {decks.map((deck) => {
        const audioRef = audioRefs[deck];
        return (
          <audio
            key={deck}
            ref={audioRef}
            preload="metadata"
            crossOrigin="anonymous"
            aria-hidden="true"
            onTimeUpdate={(event) => handleTimeUpdate(deck, event.currentTarget)}
            onLoadedMetadata={(event) =>
              handleLoadedMetadata(deck, event.currentTarget)
            }
            onCanPlay={() => startCrossfade()}
            onEnded={() => handleEnded(deck)}
            onError={(event) => handleAudioError(deck, event.currentTarget)}
          />
        );
      })}
    </>
  );
}

export default AudioEngine;
