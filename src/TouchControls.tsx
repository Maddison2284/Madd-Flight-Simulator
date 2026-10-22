import { useEffect, useRef, useState } from "react";
import { clamp } from "./physics";
export type TouchAxes = { pitch: number; roll: number; yaw: number };
export function TouchControls({
  onAxes,
  throttle,
  onThrottle,
}: {
  onAxes: (axes: TouchAxes) => void;
  throttle: number;
  onThrottle: (value: number) => void;
}) {
  const axes = useRef<TouchAxes>({ pitch: 0, roll: 0, yaw: 0 });
  const pointer = useRef<number | null>(null),
    rudders = useRef(new Map<number, number>());
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const update = (patch: Partial<TouchAxes>) => {
    axes.current = { ...axes.current, ...patch };
    onAxes(axes.current);
  };
  const reset = () => {
    pointer.current = null;
    rudders.current.clear();
    axes.current = { pitch: 0, roll: 0, yaw: 0 };
    setStick({ x: 0, y: 0 });
    onAxes(axes.current);
  };
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) reset();
    };
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      onAxes({ pitch: 0, roll: 0, yaw: 0 });
    };
  }, []);
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (pointer.current !== e.pointerId) return;
    const b = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - b.left - b.width / 2) / (b.width * 0.36),
      y = (e.clientY - b.top - b.height / 2) / (b.height * 0.36);
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    setStick({ x, y });
    update({
      roll: Math.abs(x) < 0.08 ? 0 : x,
      pitch: Math.abs(y) < 0.08 ? 0 : y,
    });
  }
  function release(e: React.PointerEvent<HTMLDivElement>) {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    setStick({ x: 0, y: 0 });
    update({ roll: 0, pitch: 0 });
  }
  function releaseRudder(e: React.PointerEvent<HTMLButtonElement>) {
    rudders.current.delete(e.pointerId);
    update({
      yaw: clamp(
        [...rudders.current.values()].reduce((a, b) => a + b, 0),
        -1,
        1,
      ),
    });
  }
  return (
    <section
      className="touch-controls"
      aria-label="Touch flight controls"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => {
        if (e.cancelable && !(e.target as HTMLElement).closest("input"))
          e.preventDefault();
        e.stopPropagation();
      }}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div className="stick-group">
        <div
          className="touch-stick"
          role="group"
          aria-label="Flight stick: drag down to climb, up to descend, left or right to roll"
          onPointerDown={(e) => {
            if (pointer.current !== null) return;
            e.preventDefault();
            pointer.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            move(e);
          }}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        >
          <span className="stick-cross">＋</span>
          <span
            className="stick-knob"
            style={{
              transform: `translate(${stick.x * 42}px,${stick.y * 42}px)`,
            }}
          />
        </div>
        <small>DRAG TO FLY · DOWN = CLIMB</small>
      </div>
      <div className="touch-power">
        <label htmlFor="touch-throttle">
          THROTTLE <b>{Math.round(throttle * 100)}%</b>
        </label>
        <input
          id="touch-throttle"
          aria-label="Touch throttle"
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(throttle * 100)}
          onChange={(e) => onThrottle(Number(e.target.value) / 100)}
        />
        <div className="rudder-buttons">
          {[
            [-1, "Yaw left"],
            [1, "Yaw right"],
          ].map(([direction, label]) => (
            <button
              key={label}
              aria-label={String(label)}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                rudders.current.set(e.pointerId, Number(direction));
                update({
                  yaw: clamp(
                    [...rudders.current.values()].reduce((a, b) => a + b, 0),
                    -1,
                    1,
                  ),
                });
              }}
              onPointerUp={releaseRudder}
              onPointerCancel={releaseRudder}
              onLostPointerCapture={releaseRudder}
            >
              {direction === -1 ? "↶" : "↷"} <span>{label}</span>
            </button>
          ))}
        </div>
        <small>HOLD RUDDER TO TURN</small>
      </div>
    </section>
  );
}
