import { useEffect, useRef } from "react";
import { getAudioAnalyser } from "../lib/audioGraph";

function SpectrumVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame = 0;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const bins = new Uint8Array(1024);
    const render = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(bounds.width * pixelRatio));
      const height = Math.max(1, Math.floor(bounds.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, width, height);
      const analyser = getAudioAnalyser();
      analyser?.getByteFrequencyData(bins);
      const count = 42;
      const gap = Math.max(2, pixelRatio * 3);
      const barWidth = (width - gap * (count - 1)) / count;
      const gradient = context.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, "rgba(138, 43, 226, 0.6)");
      gradient.addColorStop(1, "rgba(0, 210, 255, 0.95)");
      context.fillStyle = gradient;

      for (let index = 0; index < count; index += 1) {
        const ratio = index / (count - 1);
        const bin = Math.floor(ratio * ratio * (bins.length - 1));
        const liveValue = analyser ? bins[bin] / 255 : 0;
        const idleValue = 0.16 + ((index * 17 + 11) % 70) / 180;
        const value = analyser ? liveValue : idleValue;
        const barHeight = Math.max(3 * pixelRatio, value * height);
        const x = index * (barWidth + gap);
        context.fillRect(x, height - barHeight, barWidth, barHeight);
      }

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return <canvas className="spectrum-visualizer" ref={canvasRef} aria-label="Live audio spectrum" />;
}

export default SpectrumVisualizer;
