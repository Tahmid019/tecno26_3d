import * as THREE from 'three';
import { turnAbout, type Bones } from './rig.ts';

/**
 * The Meshy clips hold the arms well out from the body, a leftover of the
 * A-pose the rig was fitted in: standing still, the student looked braced to
 * catch something. This brings the upper arms in toward the sides, most when
 * idle and least when running, where the swing needs the room.
 */
export const ARMS_IN = { Idle: .27, Walk: .17, Run: .08 } as const;

const forward = new THREE.Vector3(), q = new THREE.Quaternion();
export function settleArms(bones: Bones, root: THREE.Object3D, angle: number) {
  if (angle < 1e-3) return;
  root.getWorldQuaternion(q);
  forward.set(0, 0, 1).applyQuaternion(q);
  // Turning about the facing axis swings the left arm in with a negative
  // angle and the right arm with a positive one.
  turnAbout(bones.LeftArm, forward, -angle);
  turnAbout(bones.RightArm, forward, angle);
}

/** How far to bring the arms in, from the weights of the clips now playing. */
export function armsInFor(actions: Record<string, THREE.AnimationAction>) {
  let angle = 0;
  for (const [name, amount] of Object.entries(ARMS_IN)) {
    const action = actions[name];
    if (action?.isRunning()) angle += action.getEffectiveWeight() * amount;
  }
  return angle;
}
