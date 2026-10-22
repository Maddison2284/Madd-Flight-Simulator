import type { Controls } from "./physics";
/** W pushes down and S pulls up about the aircraft's own lateral axis. */
export function keyboardControls(keys: ReadonlySet<string>): Controls {
  return {
    pitch:
      Number(keys.has("arrowdown") || keys.has("s")) -
      Number(keys.has("arrowup") || keys.has("w")),
    roll:
      Number(keys.has("arrowright") || keys.has("d")) -
      Number(keys.has("arrowleft") || keys.has("a")),
    yaw: Number(keys.has("e")) - Number(keys.has("q")),
    throttle: Number(keys.has("=") || keys.has("+")) - Number(keys.has("-")),
  };
}
