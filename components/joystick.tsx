'use client';
import { useCallback, useRef, useState } from 'react';
import { ChevronsUp } from 'lucide-react';

/**
 * The round thumb stick from a phone shooter: drag anywhere inside the ring to
 * walk, as fast as it is pushed, and right against the rim to run. The chip
 * above it is the sprint lock, and it works both ways round: tap it, or drag
 * your thumb on up past the rim onto the chip, hold it there a moment and
 * let go. An ordinary push forward, however hard, never locks it.
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
  // When the thumb first reached the chip, for the moment it has to stay there.
  const onChip = useRef(0);

  const track = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const box = base.current?.getBoundingClientRect();
    if (!box) return;
    const radius = box.width / 2;
    let x = (event.clientX - (box.left + radius)) / radius;
    let y = (event.clientY - (box.top + radius)) / radius;
    // The thumb itself, before it is held to the ring: well past the rim and
    // up on the chip, and kept there a moment, arms the lock.
    const reachingChip = !locked && y < -1.32 && Math.abs(x) < .45;
    const now = performance.now();
    if (!reachingChip) onChip.current = 0;
    else if (!onChip.current) onChip.current = now;
    setArmed(reachingChip && now - onChip.current > 140);
    const reach = Math.hypot(x, y);
    if (reach > 1) { x /= reach; y /= reach; }
    setKnob({ x, y });
    onMove(x, -y);
  }, [locked, onMove]);

  const release = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    // A thumb held perfectly still on the chip sends no moves, so the time is checked again here.
    if (armed || (!locked && onChip.current && performance.now() - onChip.current > 140)) onLock();
    onChip.current = 0;
    setArmed(false);
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  }, [armed, locked, onLock, onMove]);

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
      aria-label="Movement stick: drag to walk, push to the rim to run, drag up onto the chip to lock a sprint"
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
