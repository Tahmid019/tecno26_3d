import * as THREE from 'three';

/** Distance to the first obstacle along a ray, or null when the way is clear. */
export type ObstacleProbe = (origin: THREE.Vector3, direction: THREE.Vector3, far: number) => number | null;

/**
 * Surfaces the boom passes through instead of drawing in for. Leaves, trunks,
 * posts, nets and window grilles are thin enough to flicker in and out of the
 * boom's ray at riding pace, and every flicker used to pull the camera in and
 * let it out again: the canopies over the library road alone set it pumping
 * several times a second. Walls, roofs, glazing and the ground still stop it.
 */
export const CAMERA_PASSES_THROUGH = /hedge|trunk|canopy|foliage|leaf|bark|netting|streetlight|lamp|lantern|grille|frame|fixture|flag|statue|bronze|gold|artwork|bins|awning|truss|marking|chalk|stripe/i;

/**
 * The third-person camera: a boom from a pivot above the student's head.
 *
 * It is fixed to that pivot rather than chasing it. A camera that lerps after
 * a moving target trails it by a distance that depends on the frame time, so
 * at riding pace every uneven frame nudged the whole picture. Instead, each
 * thing that should be smooth is smoothed on its own:
 * - the pivot height, so kerbs and steps lift the student without jolting the view;
 * - the boom length, which draws in quickly when a wall is in the way and lets
 *   out slowly, so it cannot pump when something passes behind.
 * Horizontally the pivot is the student, drawn between physics steps, so the
 * student holds still on screen at any speed and any frame rate.
 */
export class FollowCamera {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  boom = 0;
  private height = Number.NaN;
  private sinceBlocked = Infinity;
  private readonly offset = new THREE.Vector3();
  private readonly aside = new THREE.Vector3();
  private readonly above = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(private readonly probe: ObstacleProbe) {}

  /**
   * @param feet  where the student is drawn this frame
   * @param lift  pivot height above the feet
   * @param snap  jump straight to the framing (spawn, travel, respawn)
   */
  update(dt: number, feet: THREE.Vector3, lift: number, yaw: number, pitch: number, distance: number, snap = false) {
    const height = feet.y + lift;
    if (snap || !Number.isFinite(this.height)) this.height = height;
    else this.height += (height - this.height) * (1 - Math.exp(-dt * 10));
    this.target.set(feet.x, this.height, feet.z);

    this.offset.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance + 1,
      Math.cos(yaw) * Math.cos(pitch) * distance);
    const reach = this.offset.length();
    this.offset.divideScalar(reach);

    // A thin bundle of rays rather than one: a single ray grazing an edge
    // flickers between hit and miss from one frame to the next.
    this.aside.crossVectors(this.offset, FollowCamera.UP);
    if (this.aside.lengthSq() < 1e-6) this.aside.set(1, 0, 0);
    this.aside.normalize().multiplyScalar(.16);
    this.above.crossVectors(this.aside, this.offset).normalize().multiplyScalar(.16);
    let clear = reach;
    for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.origin.copy(this.target).addScaledVector(this.aside, a).addScaledVector(this.above, b);
      const hit = this.probe(this.origin, this.offset, reach + .2);
      if (hit !== null && hit < clear) clear = hit;
    }
    const wanted = clear < reach ? Math.max(.55, clear - .3) : reach;
    this.sinceBlocked = clear < reach ? 0 : this.sinceBlocked + dt;

    if (snap || this.boom <= 0) this.boom = wanted;
    else if (wanted < this.boom) {
      // Draw in fast, and at once for a wall that is suddenly much closer.
      this.boom = wanted < this.boom * .6 ? wanted : this.boom + (wanted - this.boom) * (1 - Math.exp(-dt * 25));
    } else {
      // Let out slowly after an obstacle, briskly when the player zooms out.
      const rate = this.sinceBlocked < .6 ? 2.5 : 9;
      this.boom += (wanted - this.boom) * (1 - Math.exp(-dt * rate));
    }
    this.position.copy(this.target).addScaledVector(this.offset, this.boom);
    return this;
  }
}

/**
 * Fixed-step simulation with the drawn state blended between steps.
 *
 * Physics runs at 120 Hz whatever the display does, so a frame can hold zero,
 * one, two or three steps. Drawing the student at the last step made the
 * distance covered per frame uneven, 0.12 m one frame and 0.36 m the next at
 * riding pace, which is what shook the view. `alpha` says how far the display
 * has run past the last step, for blending the previous and current states.
 */
export class FixedStep {
  private accumulator = 0;
  constructor(readonly step = 1 / 120, readonly maxSteps = 12) {}
  /** Runs the due steps and returns the blend factor for drawing. */
  advance(elapsed: number, run: (step: number) => void) {
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      run(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    // Past the step cap the backlog is dropped, not carried: a long stall
    // should not play back as a burst of speed.
    if (this.accumulator >= this.step) this.accumulator = this.step * .999;
    return this.accumulator / this.step;
  }
  reset() { this.accumulator = 0; }
}
