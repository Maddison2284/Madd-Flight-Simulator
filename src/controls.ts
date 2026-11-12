import type { Controls } from "./physics";
/** W pushes down and S pulls up about the aircraft's own lateral axis.
 * +/− (and R/F) move the throttle, or the collective in a helicopter.
 * On the saucer, Space also climbs (R/+). Space applies the wheel brakes
 * on the ground for other aircraft. */
export function keyboardControls(
  keys: ReadonlySet<string>,
  mode?: "saucer" | "heli" | "plane",
): Controls {
  const saucer = mode === "saucer";
  return {
    pitch:
      Number(keys.has("arrowdown") || keys.has("s")) -
      Number(keys.has("arrowup") || keys.has("w")),
    roll:
      Number(keys.has("arrowright") || keys.has("d")) -
      Number(keys.has("arrowleft") || keys.has("a")),
    yaw: Number(keys.has("e")) - Number(keys.has("q")),
    throttle:
      Number(keys.has("=") || keys.has("+") || keys.has("r") || (saucer && keys.has(" "))) -
      Number(keys.has("-") || keys.has("f")),
    brake: saucer ? 0 : Number(keys.has(" ")),
  };
}
