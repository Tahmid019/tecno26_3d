  'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, ArrowUpRight, RotateCcw, MapPin, MoveUpRight, Map, ChevronDown, ArrowBigUp, Bike, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Game, GameState, Landmark } from '@/lib/game';
import { registerCampusTools } from '@/lib/webmcp';
import { CampusMap } from '@/components/campus-map';
import { Joystick } from '@/components/joystick';

import MultiplayerChat from '@/components/MultiplayerChat';
import { getRoom } from '@/lib/multiplayer';
import type { Room } from '@colyseus/sdk';

// 1. Campus destinations
const PLACES: { id: Landmark; name: string }[] = [
  { id: 'gym', name: 'Sports complex' },
  { id: 'football', name: 'Football' },
  { id: 'cricket', name: 'Cricket' },
  { id: 'courts', name: 'Basketball' },
  { id: 'concert', name: 'Concert' },
  { id: 'library', name: 'Library' },
  { id: 'gallery', name: 'Lecture gallery' },
  { id: 'admin', name: 'Administration' },
  { id: 'gate', name: 'Main Gate'}
];

export default function Campus() {
  // 2. Refs and state
  const mount = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState(0)
  const [state, setState] = useState<GameState>({
    ready: false, playing: false, progress: 'Preparing campus', error: '', fps: 0,
    location: 'Sports complex', x: -20, z: 70, motion: 'Idle', percent: 0,
    outerPercent: 0, outerReady: false, runLock: false, riding: false, canMount: false,
  });

  // online players
  useEffect(() => {
    let currentRoom: Room | null = null;
    let remove: (() => void) | undefined;

    const timer = setInterval(() => {
      const current = getRoom();

      if (current && current !== currentRoom) {
        remove?.();
        currentRoom = current;
        setRoom(current);

        remove = current.onMessage("onlineCount", (data: { count: number }) => {
          setOnlinePlayers(data.count);
        });
      }
    }, 500);

    return () => {
      clearInterval(timer);
      remove?.();
    };
  }, []);

  // game connection effect
  useEffect(() => {
    const timer = setInterval(() => {
      const current = getRoom();
      if (current) setRoom(current);
    }, 500);

    return () => clearInterval(timer);
  }, []);

  // 3. Game initialization and cleanup
  useEffect(() => {
    let disposed = false;
    let unregister = () => {};

    import('@/lib/game').then(async ({ createGame }) => {
      if (disposed || !mount.current) return;
      const instance = await createGame(mount.current, (s) => {
        if (!disposed) setState(s);
      });
      if (disposed) instance.dispose();
      else {
        game.current = instance;
        unregister = registerCampusTools(instance);
      }
    }).catch(e => setState(s => ({ ...s, error: String(e.message || e) })));

    return () => {
      disposed = true;
      unregister();
      game.current?.dispose();
    };
  }, []);

  // 4. Navigation and movement controls
  const go = (id: Landmark) => {
    setOpen(false);
    game.current?.travel(id);
  };

  const hold = useCallback((key: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      game.current?.input(key, true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    },
    onPointerUp: () => game.current?.input(key, false),
    onPointerCancel: () => game.current?.input(key, false),
    onLostPointerCapture: () => game.current?.input(key, false),
  }), []);

  const stick = useCallback((x: number, y: number) => game.current?.move(x, y), []);

  // 5. Main 3D scene and header
  return <main className={`campus-app ${!state.ready ? 'loading' : ''}`}>
    <div className="scene" ref={mount} aria-label="Interactive 3D NIT Silchar campus" />

    {/* // xyz
    <div style={{
      position: 'absolute', top: 12, left: '50%',
      transform: 'translateX(-50%)', zIndex: 100,
      background: '#000b', color: '#7CFC98',
      padding: '8px 12px', borderRadius: 6,
      fontFamily: 'monospace', fontSize: 13,
      pointerEvents: 'none', whiteSpace: 'nowrap'
    }}>
      X: {state.x.toFixed(2)} | Y: {(state.y ?? 0).toFixed(2)} | Z: {state.z.toFixed(2)}
    </div> */}
    
    {state.playing && <div className="vignette" />}

    <header className="hud topbar">
      <div className="brand"></div>
      <div className="top-actions">
        <div className="flex self-center gap-1.5 text-xs text-white/70">
          <Users size={14} />
          <span>{onlinePlayers} online</span>
        </div>
        <div className={`places ${open ? 'open' : ''}`}>
          <Button className="places-toggle" disabled={!state.ready} aria-expanded={open} onClick={() => setOpen(v => !v)}>
            <Map size={15} />{state.location}<ChevronDown size={15} className="caret" />
          </Button>
          {open && <div className="places-menu" role="menu">
            {PLACES.map(p => <button key={p.id} role="menuitem" disabled={['library', 'gallery', 'admin'].includes(p.id) && !state.outerReady} onClick={() => go(p.id)}>
              {p.name}
              {['library', 'gallery', 'admin'].includes(p.id) && !state.outerReady && <em>{state.outerPercent}%</em>}
              <ArrowUpRight size={13} />
            </button>)}
            <button role="menuitem" className="overview" onClick={() => {
              setOpen(false);
              if (state.overview) game.current?.setPlaying(true);
              else game.current?.overview();
            }}>
              <Map size={14} />{state.overview ? 'Back to player' : 'Campus overview'}
            </button>
          </div>}
        </div>
        <Button className="square-button" aria-label={state.playing ? 'Pause' : 'Resume'} disabled={!state.ready} onClick={() => game.current?.setPlaying(!state.playing)}>
          {state.playing ? <Pause /> : <Play />}
        </Button>
      </div>
    </header>

    {/* 6. Location and start screen */}
    {state.playing && <div className="hud location"><MapPin size={15} /><span>{state.location}</span></div>}

    {!state.playing && !state.overview && <section className="hud start-panel">
      <h1 className="font-orbitron">Take a walk.</h1>
      <div className="control-guide">
        <span className="mobile-only"><MoveUpRight size={15} /> Drag to look</span>
        <span className="desktop-only"><MoveUpRight size={15} /> Click canvas to look</span>
        <span className="desktop-only"><kbd>ESC</kbd> Pause</span>
        <span className="desktop-only"><kbd>W A S D</kbd> Move</span>
        <span className="desktop-only"><kbd>SHIFT</kbd> Run</span>
      </div>
      {state.error
        ? <div role="alert" className="error-message">
            {state.error}
            <Button className="play-button" onClick={() => window.location.reload()}>Reload campus</Button>
          </div>
        : state.ready
          ? <Button className="play-button" onClick={() => game.current?.setPlaying(true)}>
              <Play size={17} fill="currentColor" /> Enter campus <ArrowUpRight className="arrow" />
            </Button>
          : <div className="loading">
              <div className="loading">
                <div className="loading-track">
                  <i style={{ width: `${state.percent}%` }} />
                </div>
                {/* <span>{state.progress} · {state.percent}%</span> */}
                <small>Preparing campus assets · Please wait</small>
              </div>
            </div>      
            }
    </section>}

    {/* 7. Streaming status and minimap */}
    {state.playing && !state.outerReady && <div className="hud streaming">Outer campus {state.outerPercent}%</div>}
    {state.playing && <div className="hud minimap" aria-label="Campus map with player position">
      <CampusMap x={state.x} z={state.z} />
    </div>}

    {/* 7b. Boundary glitch overlay — below mobile controls */}
    {state.outOfBounds && (
      <div className="boundary-glitch-overlay">
        <div className="hud-frame">
          <div className="corner-bracket top-left"></div>
          <div className="corner-bracket top-right"></div>
          <div className="corner-bracket bottom-left"></div>
          <div className="corner-bracket bottom-right"></div>

          <div className="hud-telemetry top-right-telemetry">
            <div>5.27.016.NET.TGY.</div>
            <div>BIT: BUES</div>
            <div>01 / 14:5:18</div>
          </div>
          <div className="hud-telemetry bottom-left-telemetry">
            PROT. F-A501
          </div>

          <div className="hud-logo"></div>

          <div className="hud-content">
            <h1 className="main-title">AREA BEYOND LIMITS</h1>
            <div className="sub-title">BOUNDARY SECTOR: UNSTABLE</div>
            <div className="sub-title">COORDINATES: DEVIANT</div>
          </div>
        </div>
      </div>
    )}

    {/* 8. Mobile movement and action controls */}
    {state.playing && <div className="hud pad" aria-label="Movement controls">
      <Joystick locked={state.runLock} onMove={stick} onLock={() => game.current?.toggleRun()} />
      <div className="actions">
        {(state.canMount || state.riding) && <Button aria-label={state.riding ? 'Get off the bicycle' : 'Ride the bicycle'} className={`round ride ${state.riding ? 'on' : ''}`} onClick={() => game.current?.toggleRide()}>
          <Bike size={26} />
        </Button>}
        {!state.riding && <Button aria-label="Jump" className="round jump" {...hold('Space')}>
          <ArrowBigUp size={30} />
        </Button>}
      </div>
    </div>}

    {/* 9. Performance and reset controls */}
    {/* {/* <footer className="hud bottom-bar">
      <span className="fps">{state.fps ? `${state.fps} FPS` : ''}</span>
      <div className="performance">
        <select aria-label="Graphics quality" value={state.quality || 'balanced'} onChange={e => game.current?.setQuality(e.target.value as 'performance' | 'balanced' | 'high')}>
          <option value="performance">Performance</option>
          <option value="balanced">Balanced</option>
          <option value="high">High</option>
        </select>
        <Button className="square-button" aria-label="Reset to sports complex" disabled={!state.ready} onClick={() => game.current?.reset()}>
          <RotateCcw size={16} />
        </Button>
      </div>
    </footer> */}
    {room && <MultiplayerChat room={room} />}
  </main>;
}