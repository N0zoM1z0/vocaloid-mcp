import { musicalPositionToTick, musicalTickToPosition, type MusicalPosition } from "./vsqx.js";


export interface TempoCurveOptions {
  timeSignatures: Array<{ measure: number; numerator: number; denominator: number }>;
  start: MusicalPosition;
  end: MusicalPosition;
  startBpm: number;
  endBpm: number;
  steps: number;
  curve: "linear" | "ease_in_out" | "exponential";
}

export function expandTempoCurve(options: TempoCurveOptions) {
  if (!Number.isFinite(options.startBpm) || options.startBpm < 20 || options.startBpm > 400) {
    throw new Error("startBpm must be in 20..400");
  }
  if (!Number.isFinite(options.endBpm) || options.endBpm < 20 || options.endBpm > 400) {
    throw new Error("endBpm must be in 20..400");
  }
  if (!Number.isInteger(options.steps) || options.steps < 2 || options.steps > 256) {
    throw new Error("steps must be an integer in 2..256");
  }
  const startTick = musicalPositionToTick(options.timeSignatures, options.start);
  const endTick = musicalPositionToTick(options.timeSignatures, options.end);
  if (endTick <= startTick) throw new Error("Tempo-curve end must follow start");
  if (options.steps > endTick - startTick + 1) {
    throw new Error("Tempo-curve steps exceed the number of distinct ticks in the requested span");
  }
  const events = Array.from({ length: options.steps }, (_, index) => {
    const ratio = index / (options.steps - 1);
    const shaped = options.curve === "ease_in_out"
      ? (1 - Math.cos(Math.PI * ratio)) / 2
      : ratio;
    const bpm = options.curve === "exponential"
      ? options.startBpm * ((options.endBpm / options.startBpm) ** ratio)
      : options.startBpm + (options.endBpm - options.startBpm) * shaped;
    const tick = index === options.steps - 1
      ? endTick
      : Math.round(startTick + (endTick - startTick) * ratio);
    const position = musicalTickToPosition(options.timeSignatures, tick);
    return {
      position: { measure: position.measure, beat: position.beat, tick: position.tick ?? 0 },
      bpm: Number(bpm.toFixed(3)),
      tick,
    };
  });
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.tick <= events[index - 1]!.tick) {
      throw new Error("Tempo-curve rounding produced duplicate ticks; use fewer steps");
    }
  }
  return {
    curve: options.curve,
    startTick,
    endTick,
    durationTicks: endTick - startTick,
    steps: options.steps,
    events,
  };
}
