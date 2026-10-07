/**
 * Campus sound, synthesised in the browser so there is nothing to download.
 *
 * Wind moves through the trees in slow swells, birds call from all around
 * (now and then an Asian koel, the bird every Indian campus wakes to), groups
 * of students murmur as you pass, shoes scuff softly on grass and tap on
 * paving in time with the stride, and a bicycle hums on its tyres, ticks as it
 * freewheels and has a bell. After dark the birds fall quiet and crickets
 * take over. Browsers only allow sound after a tap or click, so it starts
 * with the first one.
 */
type Surface = 'grass' | 'hard';

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let enabled = true;
  let noise: AudioBuffer | null = null;
  let wind: GainNode | null = null, leaves: GainNode | null = null, murmur: GainNode | null = null;
  let tyre: GainNode | null = null, tyreFilter: BiquadFilterNode | null = null;
  let night: GainNode | null = null;
  let windTarget = .5, windLevel = .5, nextBird = 1, nextKoel = 25, nextTick = 0, murmurPhase = 0, nextCricket = 0;
  // A handful of crickets, each in its own place and at its own pitch and pace.
  const crickets = Array.from({ length: 5 }, (_, i) => ({ pan: -.85 + i * .42 + Math.random() * .1, pitch: 4300 + Math.random() * 900, pulses: 3 + Math.floor(Math.random() * 3), level: .006 + Math.random() * .007 }));

  const random = Math.random;
  const looped = (filterType: BiquadFilterType, frequency: number, q: number, level: number) => {
    const c = ctx!, source = c.createBufferSource();
    source.buffer = noise; source.loop = true; source.loopStart = random() * 1.5;
    const filter = c.createBiquadFilter(); filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = q;
    const gain = c.createGain(); gain.gain.value = level;
    source.connect(filter).connect(gain).connect(master!);
    source.start(0, random() * 1.5);
    return { gain, filter };
  };

  const start = () => {
    if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    ctx = new Context();
    master = ctx.createGain(); master.gain.value = enabled ? .55 : 0; master.connect(ctx.destination);
    // Two seconds of pink-ish noise feed every breathy sound.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = random() * 2 - 1;
      b0 = .997 * b0 + white * .029591; b1 = .985 * b1 + white * .032534; b2 = .95 * b2 + white * .048056;
      data[i] = (b0 + b1 + b2 + white * .1848) * .5;
    }
    wind = looped('bandpass', 380, .6, .0).gain;
    leaves = looped('highpass', 2600, .5, .0).gain;
    murmur = looped('bandpass', 620, 1.4, 0).gain;
    const t = looped('lowpass', 250, .9, 0); tyre = t.gain; tyreFilter = t.filter;
    // The high, even hiss of a tropical night's insects.
    night = looped('bandpass', 5600, 2.2, 0).gain;
  };

  /** A short, enveloped noise burst: steps, ticks and scuffs. */
  const burst = (at: number, length: number, type: BiquadFilterType, frequency: number, q: number, level: number, pan = 0) => {
    const c = ctx!, source = c.createBufferSource(); source.buffer = noise;
    const filter = c.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    const gain = c.createGain(); gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + .006); gain.gain.exponentialRampToValueAtTime(.0001, at + length);
    const panner = c.createStereoPanner(); panner.pan.value = pan;
    source.connect(filter).connect(gain).connect(panner).connect(master!);
    source.start(at, random() * 1.8, length + .02);
  };

  /** A pitched note with a frequency glide: birdsong and bells. */
  const tone = (at: number, from: number, to: number, length: number, level: number, pan: number, type: OscillatorType = 'sine', vibrato = 0) => {
    const c = ctx!, osc = c.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(to, at + length);
    if (vibrato) {
      const lfo = c.createOscillator(), depth = c.createGain(); lfo.frequency.value = vibrato; depth.gain.value = from * .03;
      lfo.connect(depth).connect(osc.frequency); lfo.start(at); lfo.stop(at + length + .05);
    }
    const gain = c.createGain(); gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(.02, length * .2)); gain.gain.exponentialRampToValueAtTime(.0001, at + length);
    const panner = c.createStereoPanner(); panner.pan.value = pan;
    osc.connect(gain).connect(panner).connect(master!);
    osc.start(at); osc.stop(at + length + .05);
  };

  const bird = () => {
    const c = ctx!, at = c.currentTime + .02, pan = random() * 1.6 - .8, level = .012 + random() * .025;
    const kind = random();
    if (kind < .4) {
      // A run of bright, rising chirps.
      const base = 2600 + random() * 1800, n = 2 + Math.floor(random() * 4);
      for (let i = 0; i < n; i++) tone(at + i * (.09 + random() * .05), base, base * (1.25 + random() * .3), .06 + random() * .04, level, pan);
    } else if (kind < .75) {
      // A falling whistle, a bulbul's sort of phrase.
      const base = 1800 + random() * 1200;
      tone(at, base * 1.3, base, .22, level, pan, 'sine', 18);
      tone(at + .26, base * 1.1, base * 1.45, .16, level * .8, pan);
    } else {
      // A quick trill.
      const base = 3200 + random() * 1500;
      for (let i = 0; i < 9; i++) tone(at + i * .035, base, base * .92, .03, level * .7, pan);
    }
  };

  /** The Asian koel: 'ku-oo' calls climbing in pitch, far off across the grounds. */
  const koel = () => {
    const c = ctx!, at = c.currentTime + .05, pan = random() * 1.4 - .7, calls = 3 + Math.floor(random() * 3);
    let pitch = 620 + random() * 80;
    for (let i = 0; i < calls; i++) {
      const t = at + i * .78;
      tone(t, pitch * .82, pitch, .16, .02, pan, 'sine', 6);
      tone(t + .19, pitch, pitch * 1.18, .36, .026, pan, 'sine', 5);
      pitch *= 1.07;
    }
  };

  /** One cricket's chirp: a few quick pulses of a high, pure note. */
  const cricket = () => {
    const c = ctx!, at = c.currentTime + .02, who = crickets[Math.floor(random() * crickets.length)];
    for (let i = 0; i < who.pulses; i++) tone(at + i * .045, who.pitch, who.pitch * .985, .028, who.level, who.pan, 'triangle');
  };

  const bellAt = (level: number, pan: number) => {
    if (!ctx || !master) return;
    const at = ctx.currentTime + .01;
    for (const ring of [0, .32]) {
      // Inharmonic partials make it a bell rather than a beep.
      for (const [f, l, d] of [[2730, 1, 1.2], [4350, .5, .8], [6010, .25, .5], [1520, .3, 1.4]]) tone(at + ring, f, f * .998, d, level * l * .05, pan, 'sine');
    }
  };

  return {
    /** Starts sound; call from a tap or click. */
    start,
    get enabled() { return enabled; },
    setEnabled(on: boolean) {
      enabled = on;
      if (ctx && master) master.gain.setTargetAtTime(on ? .55 : 0, ctx.currentTime, .08);
    },
    /** A footstep: softer on grass, a short tap on hard ground. */
    step(surface: Surface, strength: number) {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const at = ctx.currentTime + .005, pan = (random() - .5) * .2;
      if (surface === 'grass') {
        burst(at, .11 + strength * .05, 'bandpass', 900 + random() * 400, .8, .05 + strength * .05, pan);
        burst(at + .015, .08, 'highpass', 3200, .5, .015 + strength * .015, pan);
      } else {
        burst(at, .055, 'bandpass', 1900 + random() * 600, 1.2, .06 + strength * .05, pan);
        burst(at, .09, 'lowpass', 180, .9, .08 + strength * .08, pan);
      }
    },
    bell() { bellAt(1, 0); },
    /** Landing from a jump: a thud through the soles and a scuff, by how hard. */
    land(surface: Surface, strength: number) {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const at = ctx.currentTime + .004, k = Math.max(.15, Math.min(1, strength));
      burst(at, .14 + k * .08, 'lowpass', 140 + k * 60, .9, .12 + k * .16, 0);
      if (surface === 'grass') burst(at + .01, .16, 'bandpass', 1000, .7, .05 + k * .06, 0);
      else burst(at + .005, .07, 'bandpass', 1700, 1.1, .06 + k * .07, 0);
    },
    /** Walking into someone: a soft bump of shoulders. */
    bump() {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const at = ctx.currentTime + .004;
      burst(at, .09, 'lowpass', 260, .8, .09, 0);
      burst(at, .05, 'bandpass', 900, 1.2, .03, 0);
    },
    /** A bicycle going down: a thump, then steel clattering on the road. */
    crash(strength: number) {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const at = ctx.currentTime + .005, k = Math.max(.3, Math.min(1, strength));
      burst(at, .25, 'lowpass', 150, .9, .26 * k, 0);
      for (let i = 0; i < 7; i++) burst(at + .03 + i * .055 + random() * .04, .04 + random() * .06, 'bandpass', 1600 + random() * 3400, 4 + random() * 6, (.05 + random() * .05) * k, (random() - .5) * .6);
      tone(at + .06, 2730, 2700, .5, .012 * k, .1, 'sine');
    },
    /** The bicycle's stand: a sprung steel clack. */
    stand(down: boolean) {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const at = ctx.currentTime + .005;
      burst(at, .05, 'bandpass', down ? 2300 : 2900, 6, .045, -.1);
      tone(at, down ? 1180 : 1420, down ? 1100 : 1350, .12, .012, -.1, 'triangle');
    },
    /** Someone else's bell, quieter and placed to one side. */
    bellFrom(distance: number, pan: number) { bellAt(Math.max(0, 1 - distance / 40) * .7, Math.max(-1, Math.min(1, pan))); },
    update(dt: number, s: { riding: boolean; speed: number; coasting: boolean; nearGroup: number; underTrees: number; night?: number }) {
      if (!ctx || !master || !wind || !leaves || !murmur || !tyre || !tyreFilter || !night || ctx.state !== 'running') return;
      const dark = s.night ?? 0;
      const now = ctx.currentTime;
      // Wind wanders between calm and gusty.
      if (random() < dt * .25) windTarget = .25 + random() * .75;
      windLevel += (windTarget - windLevel) * Math.min(1, dt * .4);
      wind.gain.setTargetAtTime(.022 + windLevel * .03, now, .5);
      leaves.gain.setTargetAtTime((.004 + windLevel * .012) * (.4 + s.underTrees * .6), now, .4);
      // The murmur of a group rises and falls like conversation.
      murmurPhase += dt * (2.3 + Math.sin(now * .7));
      murmur.gain.setTargetAtTime(s.nearGroup * (.018 + .012 * Math.max(0, Math.sin(murmurPhase) * Math.sin(murmurPhase * .37))), now, .08);
      // Tyres hum louder and brighter with speed.
      const rolling = s.riding ? Math.min(1, s.speed / 11) : 0;
      tyre.gain.setTargetAtTime(rolling * .07, now, .1);
      tyreFilter.frequency.setTargetAtTime(160 + rolling * 520, now, .1);
      // A freewheel ticks while coasting, faster the faster the wheel turns.
      if (s.riding && s.coasting && s.speed > .6) {
        nextTick -= dt;
        if (nextTick <= 0) { burst(now + .002, .012, 'bandpass', 4200, 4, .02, 0); nextTick = .9 / (s.speed * 1.4 + 2); }
      }
      // Birds by day (the koel calls into the dusk), crickets by night.
      nextBird -= dt;
      if (nextBird <= 0) { if (random() > dark) bird(); nextBird = .7 + random() * 3.5; }
      nextKoel -= dt;
      if (nextKoel <= 0) { if (dark < .6) koel(); nextKoel = 35 + random() * 50; }
      night.gain.setTargetAtTime(dark * .006, now, 1.5);
      nextCricket -= dt;
      if (nextCricket <= 0) { if (random() < dark) cricket(); nextCricket = .12 + random() * .35; }
    },
    suspend() { if (ctx && ctx.state === 'running') void ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') void ctx.resume(); },
    dispose() { if (ctx) void ctx.close(); ctx = null; },
  };
}
export type CampusAudio = ReturnType<typeof createAudio>;
