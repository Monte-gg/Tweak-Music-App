export type AudioGraph = {
  context: AudioContext;
  deckGains: [GainNode, GainNode];
  equalizer: BiquadFilterNode[];
  bassBoost: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  masterGain: GainNode;
};

const bandFrequencies = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const mediaSources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
let sharedGraph: AudioGraph | null = null;

export function getOrCreateAudioGraph(
  audioElements: [HTMLAudioElement, HTMLAudioElement],
): AudioGraph {
  if (!sharedGraph) {
    if (!window.AudioContext) {
      throw new Error("Web Audio is not supported in this browser.");
    }

    const context = new AudioContext();
    const deckGains: [GainNode, GainNode] = [
      context.createGain(),
      context.createGain(),
    ];
    const equalizer = bandFrequencies.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      filter.type = index === 0 ? "lowshelf" : index === 9 ? "highshelf" : "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1.4;
      return filter;
    });
    const bassBoost = context.createBiquadFilter();
    bassBoost.type = "lowshelf";
    bassBoost.frequency.value = 100;
    const compressor = context.createDynamicsCompressor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    const masterGain = context.createGain();

    deckGains.forEach((gain) => gain.connect(equalizer[0]));
    equalizer.forEach((filter, index) => {
      filter.connect(index === equalizer.length - 1 ? bassBoost : equalizer[index + 1]);
    });
    bassBoost.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(masterGain);
    masterGain.connect(context.destination);
    deckGains[0].gain.value = 1;
    deckGains[1].gain.value = 0;
    equalizer[0].gain.value = 0;
    bassBoost.gain.value = 0;
    compressor.threshold.value = 0;
    compressor.ratio.value = 1;
    masterGain.gain.value = 0.8;

    sharedGraph = {
      context,
      deckGains,
      equalizer,
      bassBoost,
      compressor,
      analyser,
      masterGain,
    };
  }

  if (!sharedGraph) {
    throw new Error("The audio graph could not be initialized.");
  }
  const graph = sharedGraph;
  audioElements.forEach((audio, index) => {
    if (!mediaSources.has(audio)) {
      const source = graph.context.createMediaElementSource(audio);
      source.connect(graph.deckGains[index]);
      mediaSources.set(audio, source);
    }
  });

  return graph;
}

export function getAudioAnalyser(): AnalyserNode | null {
  return sharedGraph?.analyser ?? null;
}

export function applyAudioSettings(
  graph: AudioGraph,
  equalizerGains: number[],
  bassBoost: number,
  normalizerEnabled: boolean,
  volume: number,
): void {
  const now = graph.context.currentTime;
  equalizerGains.forEach((gain, index) => {
    graph.equalizer[index]?.gain.setTargetAtTime(gain, now, 0.02);
  });
  graph.bassBoost.gain.setTargetAtTime(bassBoost, now, 0.02);
  graph.compressor.threshold.setTargetAtTime(
    normalizerEnabled ? -24 : 0,
    now,
    0.02,
  );
  graph.compressor.knee.setTargetAtTime(normalizerEnabled ? 24 : 0, now, 0.02);
  graph.compressor.ratio.setTargetAtTime(normalizerEnabled ? 8 : 1, now, 0.02);
  graph.compressor.attack.setTargetAtTime(normalizerEnabled ? 0.003 : 0.01, now, 0.02);
  graph.compressor.release.setTargetAtTime(normalizerEnabled ? 0.25 : 0.1, now, 0.02);
  graph.masterGain.gain.setTargetAtTime(volume, now, 0.02);
}

export function setDeckGain(graph: AudioGraph, deck: 0 | 1, gain: number): void {
  const parameter = graph.deckGains[deck].gain;
  parameter.cancelScheduledValues(graph.context.currentTime);
  parameter.setValueAtTime(gain, graph.context.currentTime);
}

export function scheduleDeckCrossfade(
  graph: AudioGraph,
  from: 0 | 1,
  to: 0 | 1,
  duration: number,
): void {
  const now = graph.context.currentTime;
  const end = now + duration;
  for (const [deck, value] of [[from, 1], [to, 0]] as const) {
    const parameter = graph.deckGains[deck].gain;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(value, now);
  }
  graph.deckGains[from].gain.linearRampToValueAtTime(0, end);
  graph.deckGains[to].gain.linearRampToValueAtTime(1, end);
}
