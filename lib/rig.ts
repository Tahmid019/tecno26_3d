import * as THREE from 'three';

/**
 * Bone tools for the student and the other students on campus. They share one
 * Meshy humanoid rig, whose bones all start in a T-pose facing +Z with the
 * character's left on +X. Everything here works in world space and turns bones
 * by the smallest rotation between two directions, so it never needs to know
 * which local axis a bone happens to point along.
 */
export const BONE_NAMES = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head', 'headfront',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'] as const;
export type BoneName = typeof BONE_NAMES[number];
export type Bones = Record<BoneName, THREE.Object3D>;

export function findBones(root: THREE.Object3D): Bones {
  const bones = {} as Bones;
  for (const name of BONE_NAMES) {
    const bone = root.getObjectByName(name);
    if (!bone) throw new Error(`The character has no ${name} bone`);
    bones[name] = bone;
  }
  return bones;
}

const parentQ = new THREE.Quaternion(), boneQ = new THREE.Quaternion(), turn = new THREE.Quaternion(), still = new THREE.Quaternion();
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), axis = new THREE.Vector3(), bend = new THREE.Vector3(), joint = new THREE.Vector3();

/** Turns a bone in world space by `delta`, keeping its children attached. */
export function turnWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(parentQ);
  bone.getWorldQuaternion(boneQ);
  boneQ.premultiply(delta);
  bone.quaternion.copy(parentQ.invert().multiply(boneQ));
  bone.updateMatrixWorld(true);
}

/** Turns a bone about a world axis through its own joint. */
export function turnAbout(bone: THREE.Object3D, worldAxis: THREE.Vector3, angle: number) {
  if (Math.abs(angle) < 1e-6) return;
  turnWorld(bone, turn.setFromAxisAngle(worldAxis, angle));
}

/** Places a bone at a world position by moving it within its parent. */
export function setWorldPosition(bone: THREE.Object3D, world: THREE.Vector3) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.position.copy(bone.parent!.worldToLocal(va.copy(world)));
  bone.updateMatrixWorld(true);
}

/**
 * Swings a bone so the direction from it to `tip` (a bone it carries) turns
 * toward `direction`. `amount` below 1 swings only part of the way.
 */
export function aim(bone: THREE.Object3D, tip: THREE.Object3D, direction: THREE.Vector3, amount = 1) {
  bone.getWorldPosition(va);
  tip.getWorldPosition(vb).sub(va);
  if (vb.lengthSq() < 1e-10 || direction.lengthSq() < 1e-10) return;
  turn.setFromUnitVectors(vb.normalize(), vc.copy(direction).normalize());
  if (amount < 1) turn.slerp(still.identity(), 1 - amount);
  turnWorld(bone, turn);
}

/**
 * Two-bone inverse kinematics: bends upper → lower → end so that `end`
 * reaches `target`, with the middle joint (knee or elbow) bowing towards
 * `pole`. Returns how far short of the target the chain fell, in metres.
 */
export function reach(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3) {
  upper.getWorldPosition(a); lower.getWorldPosition(b); end.getWorldPosition(c);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  axis.copy(target).sub(a);
  const wanted = axis.length();
  const d = THREE.MathUtils.clamp(wanted, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  axis.normalize();
  // The bend lies in the plane through the chain's root, the target and the pole.
  bend.copy(pole).sub(a);
  bend.addScaledVector(axis, -bend.dot(axis));
  if (bend.lengthSq() < 1e-8) { bend.copy(b).sub(a); bend.addScaledVector(axis, -bend.dot(axis)); }
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
  bend.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const across = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  joint.copy(a).addScaledVector(axis, along).addScaledVector(bend, across);
  turn.setFromUnitVectors(vb.copy(b).sub(a).normalize(), vc.copy(joint).sub(a).normalize());
  turnWorld(upper, turn);
  lower.getWorldPosition(b); end.getWorldPosition(c);
  joint.copy(a).addScaledVector(axis, d);
  turn.setFromUnitVectors(vb.copy(c).sub(b).normalize(), vc.copy(joint).sub(b).normalize());
  turnWorld(lower, turn);
  return Math.max(0, wanted - d);
}

/** Records the local pose of some bones, then blends a new pose against it. */
export function poseBuffer(bones: THREE.Object3D[]) {
  const rotations = bones.map(() => new THREE.Quaternion());
  const positions = bones.map(() => new THREE.Vector3());
  const q = new THREE.Quaternion();
  return {
    save() { bones.forEach((bone, i) => { rotations[i].copy(bone.quaternion); positions[i].copy(bone.position); }); },
    restore() { bones.forEach((bone, i) => { bone.quaternion.copy(rotations[i]); bone.position.copy(positions[i]); }); },
    /** Leaves each bone `weight` of the way from the saved pose to its current one. */
    blend(weight: number) {
      if (weight >= .999) return;
      bones.forEach((bone, i) => {
        bone.quaternion.copy(q.copy(rotations[i]).slerp(bone.quaternion, weight));
        bone.position.lerpVectors(positions[i], bone.position, weight);
      });
    },
  };
}
