import { useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { cn } from "./lib/cn.js";

const MOOD_LABELS = [
  { id: "calm", label: "Calm", range: [0, 0.35] },
  { id: "energetic", label: "Energetic", range: [0.35, 0.7] },
  { id: "intense", label: "Intense", range: [0.7, 1] },
];

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function getMood(value) {
  return MOOD_LABELS.find((mood) => value >= mood.range[0] && value < mood.range[1]) ??
    MOOD_LABELS[0];
}

const MAX_POINTS = 1400;

export default function App() {
  const canvasRef = useRef(null);
  const animationRef = useRef(0);
  const audioRef = useRef({
    context: null,
    analyser: null,
    source: null,
    data: null,
  });
  const smoothingRef = useRef([]);
  const scribbleRef = useRef({
    points: [],
    pen: null,
    seed: Math.random() * 1000,
  });
  const isVisibleRef = useRef(true);
  const moodRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const listeningRef = useRef(false);
  const permissionRef = useRef("idle");

  const [isListening, setIsListening] = useState(false);
  const [permission, setPermission] = useState("idle");
  const [level, setLevel] = useState(0);
  const [moodValue, setMoodValue] = useState(0);
  const [sensitivity, setSensitivity] = useState(1.2);
  const [statusMessage, setStatusMessage] = useState(
    "Tap anywhere to enable the microphone."
  );
  const [showSettings, setShowSettings] = useState(false);

  const prefersReducedMotion = useReducedMotion();

  const mood = useMemo(() => getMood(moodValue), [moodValue]);

  useEffect(() => {
    moodRef.current = moodValue;
  }, [moodValue]);

  useEffect(() => {
    reducedMotionRef.current = prefersReducedMotion;
  }, [prefersReducedMotion]);

  useEffect(() => {
    listeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    permissionRef.current = permission;
  }, [permission]);

  const resetScribble = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    scribbleRef.current = {
      points: [],
      pen: {
        x: width * 0.5 + (Math.random() - 0.5) * width * 0.2,
        y: height * 0.5 + (Math.random() - 0.5) * height * 0.2,
        angle: Math.random() * Math.PI * 2,
      },
      seed: Math.random() * 1000,
    };
  };

  const animateCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { innerWidth: width, innerHeight: height } = window;

    const moodFactor = moodRef.current;
    const intensity = reducedMotionRef.current ? moodFactor * 0.5 : moodFactor;
    const time = performance.now() * 0.001;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    const scribble = scribbleRef.current;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const baseRadius = Math.min(width, height) * (0.28 + intensity * 0.2);
    const paintActive =
      listeningRef.current && permissionRef.current === "granted";
    const paintFactor = paintActive ? Math.max(0, moodFactor - 0.02) : 0;
    const speedScale = reducedMotionRef.current ? 0.6 : 1;

    if (!scribble.pen) {
      scribble.pen = {
        x: centerX,
        y: centerY,
        angle: Math.random() * Math.PI * 2,
      };
    }

    if (paintFactor > 0) {
      const pen = scribble.pen;
      const steps = Math.max(1, Math.floor(paintFactor * 8));
      const margin = Math.min(width, height) * 0.12;
      const seed = scribble.seed ?? 0;

      for (let i = 0; i < steps; i += 1) {
        const flow =
          Math.sin((pen.x + seed) * 0.004 + time * 0.6) +
          Math.cos((pen.y - seed) * 0.003 + time * 0.5);
        const turn = flow * (0.04 + paintFactor * 0.22);
        pen.angle += turn;

        const speed = (0.8 + paintFactor * 4.2) * speedScale;
        pen.x += Math.cos(pen.angle) * speed;
        pen.y += Math.sin(pen.angle) * speed;

        if (pen.x < margin || pen.x > width - margin) {
          pen.angle = Math.PI - pen.angle;
          pen.x = clamp(pen.x, margin, width - margin);
        }
        if (pen.y < margin || pen.y > height - margin) {
          pen.angle = -pen.angle;
          pen.y = clamp(pen.y, margin, height - margin);
        }

        const thickness =
          3 +
          paintFactor * 22 +
          Math.sin(time * 2 + pen.angle) * (2 + paintFactor * 6);
        scribble.points.push({
          x: pen.x,
          y: pen.y,
          w: thickness,
          seed: Math.random() * Math.PI * 2,
        });
      }

      if (scribble.points.length > MAX_POINTS) {
        scribble.points.splice(0, scribble.points.length - MAX_POINTS);
      }
    }

    if (scribble.points.length > 1) {
      const seed = scribble.seed ?? 0;
      const noiseAmp = 1 + intensity * 14;
      const pressRadius = baseRadius * (0.35 + intensity * 0.4);
      const pressStrength = baseRadius * (0.012 + intensity * 0.06);
      const pressA = {
        x: centerX + Math.cos(time * 0.4) * baseRadius * 0.5,
        y: centerY + Math.sin(time * 0.33) * baseRadius * 0.4,
      };
      const pressB = {
        x: centerX + Math.cos(time * 0.22 + 1.7) * baseRadius * 0.35,
        y: centerY + Math.sin(time * 0.28 + 0.9) * baseRadius * 0.3,
      };

      const applyPress = (x, y, px, py, strength, radius) => {
        const dx = x - px;
        const dy = y - py;
        const distance = Math.hypot(dx, dy);
        if (distance < radius) {
          const falloff = 1 - distance / radius;
          const press = strength * falloff * falloff;
          const nx = dx / (distance + 0.001);
          const ny = dy / (distance + 0.001);
          x -= nx * press;
          y -= ny * press;
          x += -ny * press * 0.25;
          y += nx * press * 0.25;
          return { x, y, pressure: falloff };
        }
        return { x, y, pressure: 0 };
      };

      const warpPoint = (point, offset) => {
        let x = point.x;
        let y = point.y;

        x +=
          Math.sin(time * 0.8 + (x + seed) * 0.005 + offset) * noiseAmp;
        y +=
          Math.cos(time * 0.7 + (y - seed) * 0.004 - offset) * noiseAmp;

        const dx = x - centerX;
        const dy = y - centerY;
        const twist =
          Math.sin(time * 0.3 + (dx + dy) * 0.002) * intensity * 0.12;
        x += -dy * twist;
        y += dx * twist;

        let pressure = 0;
        const press1 = applyPress(x, y, pressA.x, pressA.y, pressStrength, pressRadius);
        x = press1.x;
        y = press1.y;
        pressure = Math.max(pressure, press1.pressure);

        if (intensity > 0.3) {
          const press2 = applyPress(x, y, pressB.x, pressB.y, pressStrength * 0.7, pressRadius * 0.85);
          x = press2.x;
          y = press2.y;
          pressure = Math.max(pressure, press2.pressure);
        }

        return { x, y, pressure };
      };

      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const passes = [
        { alpha: 0.25, width: 1.9, offset: 0.6 },
        { alpha: 0.95, width: 1, offset: 0 },
      ];

      passes.forEach((pass) => {
        for (let i = 1; i < scribble.points.length; i += 1) {
          const prev = warpPoint(scribble.points[i - 1], pass.offset);
          const next = warpPoint(scribble.points[i], pass.offset);
          const baseWidth = (scribble.points[i].w + scribble.points[i - 1].w) * 0.5;
          const wobble =
            0.7 + 0.3 * Math.sin(time * 1.4 + scribble.points[i].seed);
          const width =
            Math.max(1.5, baseWidth * (1 + next.pressure * (0.6 + intensity)) * wobble) *
            pass.width;

          ctx.strokeStyle = `rgba(0, 0, 0, ${pass.alpha})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }
      });

      ctx.restore();
    }

    if (isVisibleRef.current) {
      animationRef.current = requestAnimationFrame(animateCanvas);
    }
  };

  useEffect(() => {
    const handleVisibility = () => {
      isVisibleRef.current = document.visibilityState === "visible";
      if (!isVisibleRef.current && animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (isVisibleRef.current) {
        animationRef.current = requestAnimationFrame(animateCanvas);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const { innerWidth: width, innerHeight: height, devicePixelRatio } = window;
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);
    animationRef.current = requestAnimationFrame(animateCanvas);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    const handlePointer = () => {
      if (!isListening && permission !== "granted") startListening();
    };

    window.addEventListener("pointerdown", handlePointer, { passive: true });
    return () => window.removeEventListener("pointerdown", handlePointer);
  }, [isListening, permission]);

  useEffect(() => {
    if (!isListening) return;

    const audioLoop = () => {
      // RMS volume detection with a small moving average to smooth jitter.
      const analyser = audioRef.current.analyser;
      const data = audioRef.current.data;
      if (!analyser || !data) return;

      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / data.length);
      const adjusted = clamp(rms * sensitivity, 0, 1);

      const history = smoothingRef.current;
      history.push(adjusted);
      if (history.length > 12) {
        history.shift();
      }
      const average = history.reduce((acc, value) => acc + value, 0) / history.length;

      setLevel(average);
      setMoodValue(average);

      requestAnimationFrame(audioLoop);
    };

    requestAnimationFrame(audioLoop);
  }, [isListening, sensitivity]);

  const startListening = async () => {
    setStatusMessage("Listening… use your voice to draw.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      audioRef.current = { context, analyser, source, data };
      smoothingRef.current = [];
      resetScribble();

      setPermission("granted");
      setIsListening(true);
    } catch (error) {
      setPermission("denied");
      setIsListening(false);
      setStatusMessage("Microphone access is blocked. Tap to retry.");
    }
  };

  const stopListening = () => {
    const { context } = audioRef.current;
    if (context) {
      context.close();
    }
    audioRef.current = { context: null, analyser: null, source: null, data: null };
    smoothingRef.current = [];
    setIsListening(false);
    setLevel(0);
    setMoodValue(0);
    setStatusMessage("Tap anywhere to enable the microphone.");
  };

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="relative min-h-dvh overflow-hidden bg-white"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />

        <div className="pointer-events-none absolute inset-0 flex items-end justify-center px-4 pb-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="pointer-events-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="text-pretty">{statusMessage}</span>
                <button
                  type="button"
                  onClick={() => setShowSettings((prev) => !prev)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600"
                >
                  {showSettings ? "Hide" : "Settings"}
                </button>
              </div>

              {showSettings && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-medium">Mic level</span>
                      <span className="tabular-nums">{level.toFixed(2)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full origin-left bg-slate-700 transition-transform duration-150 ease-out"
                        style={{ transform: `scaleX(${clamp(level, 0, 1)})` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="font-medium">Mood</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {mood.label}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500" htmlFor="sensitivity">
                      Sensitivity
                    </label>
                    <input
                      id="sensitivity"
                      type="range"
                      min="0.6"
                      max="2.2"
                      step="0.05"
                      value={sensitivity}
                      onChange={(event) => setSensitivity(Number(event.target.value))}
                      className="w-full accent-slate-700"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={isListening ? stopListening : startListening}
                      className={cn(
                        "inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold",
                        "transition-transform duration-150 ease-out",
                        isListening
                          ? "bg-slate-900 text-white"
                          : "bg-slate-200 text-slate-700"
                      )}
                    >
                      {isListening ? "Stop Mic" : "Start Mic"}
                    </button>
                    {permission === "denied" && (
                      <button
                        type="button"
                        onClick={startListening}
                        className="text-xs font-medium text-rose-500"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </MotionConfig>
  );
}
