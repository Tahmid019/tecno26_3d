'use client';
import { useCallback, useRef, useState } from 'react';
import { ChevronsUp } from 'lucide-react';

/**
 * The round thumb stick from a phone shooter: drag anywhere inside the ring to
 * walk, push it to the rim to run. The chip above it is the sprint lock, and it
 * works both ways round — tap it, or shove the stick straight up onto it.
 */
export function Joystick({ onMove, onLock, locked }: {
  onMove: (x: number, y: number) => void;
  onLock: () => void;
  locked: boolean;
}) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [armed, setArmed] = useState(false);
  const active = useRef(false);

  const track = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const box = base.current?.getBoundingClientRect();
    if (!box) return;
    const radius = box.width / 2;
    let x = (event.clientX - (box.left + radius)) / radius;
    let y = (event.clientY - (box.top + radius)) / radius;
    const reach = Math.hypot(x, y);
    if (reach > 1) { x /= reach; y /= reach; }
    setKnob({ x, y });
    // Straight up and hard against the rim arms the lock.
    setArmed(!locked && y < -.78 && Math.abs(x) < .5);
    onMove(x, -y);
  }, [locked, onMove]);

  const release = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    if (armed) onLock();
    setArmed(false);
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  }, [armed, onLock, onMove]);

  return <div className={`stick ${locked ? 'locked' : ''} ${armed ? 'armed' : ''}`}>
    <button
      type="button"
      className="stick-lock"
      aria-pressed={locked}
      aria-label={locked ? 'Stop the sprint' : 'Lock a sprint'}
      onClick={onLock}
    ><ChevronsUp size={19} /></button>
    <div
      ref={base}
      className="stick-base"
      role="application"
      aria-label="Movement stick: drag to walk, push to the rim to run, push up to lock a sprint"
      onPointerDown={event => {
        event.preventDefault();
        active.current = true;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
        track(event);
      }}
      onPointerMove={event => { if (active.current) track(event); }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className="stick-knob" style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  </div>;
}
