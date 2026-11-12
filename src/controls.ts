import type { Controls } from "./physics";
/** Planes/heli: W pushes down and S pulls up about the aircraft's own
 * lateral axis; +/− (and R/F) move the throttle, or the collective in a
 * helicopter. Space applies the wheel brakes on the ground.
 * Saucer: W / R / Space = UP, S / F = DOWN (direct vertical), ↑/↓ push
 * forward/back, A/D and ←/→ bank and turn, Q/E yaw, +/− forward throttle. */
export function keyboardControls(
  keys: ReadonlySet<string>,
  mode?: "saucer" | "heli" | "plane",
): Controls {
  const saucer = mode === "saucer";
  const roll =
    Number(keys.has("arrowright") || keys.has("d")) -
    Number(keys.has("arrowleft") || keys.has("a"));
  const yaw = Number(keys.has("e")) - Number(keys.has("q"));
  if (saucer)
    return {
      pitch: 0,
      roll,
      yaw,
      throttle: Number(keys.has("=") || keys.has("+")) - Number(keys.has("-")),
      vertical:
        Number(keys.has("w") || keys.has("r") || keys.has(" ")) -
        Number(keys.has("s") || keys.has("f")),
      forward: Number(keys.has("arrowup")) - Number(keys.has("arrowdown")),
      brake: 0,
    };
  return {
    pitch:
      Number(keys.has("arrowdown") || keys.has("s")) -
      Number(keys.has("arrowup") || keys.has("w")),
    roll,
    yaw,
    throttle:
      Number(keys.has("=") || keys.has("+") || keys.has("r")) -
      Number(keys.has("-") || keys.has("f")),
    brake: Number(keys.has(" ")),
  };
}
