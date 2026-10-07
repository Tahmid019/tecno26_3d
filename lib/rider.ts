import * as THREE from 'three';
import { BIKE, frameMatrix, gripWorld, pedalWorld, type Bike } from './bicycle.ts';
import { findBones, poseBuffer, reach, setWorldPosition, turnAbout, turnWorld } from './rig.ts';

/**
 * Sits a character on a bicycle. The legs are solved every frame so the balls
 * of the feet stay on the pedals as the cranks turn, the hands hold the grips
 * as the bars steer, and the hips sit on the saddle; the clip underneath only
 * supplies breathing. Nothing is baked, so the same rig carries the student
 * and every other cyclist on campus, at any size and on any of the bicycles.
 */
export type RideState = {
  /** 0 seated … 1 standing on the pedals, as when sprinting. */
  standing: number;
  /** 1 when stopped with the left foot down on the ground. */
  footDown: number;
  /** Steering input, positive to the left, for the head and shoulders. */
  turn: number;
  /** Height of the ground under the bicycle, for the foot put down. */
  ground: number;
  /**
   * Getting on: 0 standing on the bicycle's left, 1 in the saddle. On the
   * way the hands take the grips, the right leg swings up and over behind
   * the saddle to its pedal, and the hips come across onto the saddle; the
   * left foot stays on the ground. Getting off runs the same way back.
   */
  mount?: number;
};

const ease = (a: number, b: number, t: number) => THREE.MathUtils.smoothstep(t, a, b);

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export function createRider(root: THREE.Object3D) {
  const bones = findBones(root);
  const b = bones;
  const posed = [b.Hips, b.Spine02, b.Spine01, b.Spine, b.neck, b.Head,
    b.LeftShoulder, b.LeftArm, b.LeftForeArm, b.LeftHand, b.RightShoulder, b.RightArm, b.RightForeArm, b.RightHand,
    b.LeftUpLeg, b.LeftLeg, b.LeftFoot, b.LeftToeBase, b.RightUpLeg, b.RightLeg, b.RightFoot, b.RightToeBase];
  const buffer = poseBuffer(posed);
  const frame = new THREE.Matrix4(), frameQ = new THREE.Quaternion(), rootQ = new THREE.Quaternion(), delta = new THREE.Quaternion();
  const forward = new THREE.Vector3(), up = new THREE.Vector3(), left = new THREE.Vector3();
  const target = new THREE.Vector3(), pole = new THREE.Vector3(), point = new THREE.Vector3(), offset = new THREE.Vector3();
  const face = new THREE.Vector3(), look = new THREE.Vector3(), headPoint = new THREE.Vector3(), frontPoint = new THREE.Vector3();
  const scratch = new THREE.Vector3(), s = new THREE.Vector3(), p = new THREE.Vector3();
  // Where the standing pose had the hips, feet and hands, for getting on and off.
  const standHips = new THREE.Vector3(), standFeet = [new THREE.Vector3(), new THREE.Vector3()], standHands = [new THREE.Vector3(), new THREE.Vector3()];
  const arc = new THREE.Vector3(), seated = new THREE.Vector3();

  /** Turns `bone` so the face (Head → headfront) points `amount` of the way along `direction`. */
  const turnFace = (bone: THREE.Object3D, direction: THREE.Vector3, amount: number) => {
    b.Head.getWorldPosition(headPoint); b.headfront.getWorldPosition(frontPoint);
    face.copy(frontPoint).sub(headPoint).normalize();
    delta.setFromUnitVectors(face, scratch.copy(direction).normalize());
    if (amount < 1) delta.slerp(rootQ.identity(), 1 - amount);
    turnWorld(bone, delta);
  };

  return {
    bones,
    /**
     * Poses the rider on `bike`, `weight` of the way from whatever pose the
     * mixer left on the bones, so mounting and dismounting blend smoothly.
     */
    apply(bike: Bike, state: RideState, weight: number) {
      if (weight <= .001) return;
      root.updateMatrixWorld(true);
      buffer.save();
      frameMatrix(bike, frame);
      frame.decompose(p, frameQ, s);
      const size = s.x;
      forward.copy(Z).applyQuaternion(frameQ);
      up.copy(Y).applyQuaternion(frameQ);
      left.copy(X).applyQuaternion(frameQ);
      const stand = state.standing;
      const mount = state.mount ?? 1, mounting = mount < .999;
      // Getting on: hands to the grips first, then the leg swings over and
      // the hips come across and down onto the saddle.
      const grip = mounting ? ease(0, .3, mount) : 1, seat = mounting ? ease(.3, .92, mount) : 1;
      const swing = mounting ? ease(.22, .82, mount) : 1, lift = mounting ? Math.sin(Math.PI * THREE.MathUtils.clamp((mount - .25) / .6, 0, 1)) : 0;
      if (mounting) {
        b.Hips.getWorldPosition(standHips);
        b.LeftFoot.getWorldPosition(standFeet[0]); b.RightFoot.getWorldPosition(standFeet[1]);
        b.LeftHand.getWorldPosition(standHands[0]); b.RightHand.getWorldPosition(standHands[1]);
      }

      // Hips: face the way the bicycle faces, tilt forward over the bars and
      // sit on the saddle, or lift clear of it when standing on the pedals.
      root.getWorldQuaternion(rootQ);
      turnWorld(b.Hips, delta.copy(frameQ).multiply(rootQ.invert()));
      // Out of the saddle the whole torso pitches forward from the hips, low
      // over the bars with the elbows bent, rather than standing up straight.
      turnAbout(b.Hips, left, (.2 + stand * .5) * (.35 + .65 * seat));
      target.copy(BIKE.saddle).add(offset.set(-state.footDown * .03, .155 + stand * .12, .03 + stand * .16)).applyMatrix4(frame);
      if (mounting) target.lerpVectors(standHips, seated.copy(target), seat).addScaledVector(up, lift * .1 * size);
      setWorldPosition(b.Hips, target);

      // The back bends on into a city rider's lean, deeper when standing,
      // and rocks with the pedal stroke out of the saddle.
      const rock = Math.sin(bike.crank) * stand;
      for (const [bone, share] of [[b.Spine02, .3], [b.Spine01, .35], [b.Spine, .35]] as const) {
        turnAbout(bone, left, (.36 + stand * .1) * share * (.3 + .7 * Math.max(grip * .55, seat)));
        turnAbout(bone, forward, -rock * .1 * share);
        turnAbout(bone, up, state.turn * .12 * share);
      }

      // Legs: the ball of each foot on its pedal, the ankle working through
      // the stroke the way a rider's does, knees tracking over the pedals.
      for (const side of [1, -1] as const) {
        const [upLeg, leg, foot, toe] = side === 1 ? [b.LeftUpLeg, b.LeftLeg, b.LeftFoot, b.LeftToeBase] : [b.RightUpLeg, b.RightLeg, b.RightFoot, b.RightToeBase];
        const angle = bike.crank + (side === 1 ? Math.PI : 0);
        const pitch = .18 + .14 * Math.sin(angle - 2.2) - stand * .08;
        pedalWorld(bike, side, point);
        // From the ball of the foot back to the ankle, in the bicycle's frame.
        offset.set(0, .098, -.115).applyAxisAngle(X, pitch).multiplyScalar(size);
        target.copy(point).add(scratch.copy(offset).applyQuaternion(frameQ));
        if (side === 1 && state.footDown > 0) {
          // Stopped: the left foot comes off its pedal to the ground beside it.
          point.set(.33, 0, .08).multiplyScalar(size).applyQuaternion(frameQ).add(p);
          point.y = state.ground + .1 * size;
          target.lerp(point, state.footDown);
        }
        if (mounting) {
          if (side === 1) target.lerpVectors(standFeet[0], seated.copy(target), seat);
          else {
            // Up from the ground, high over the back wheel behind the saddle,
            // and down onto the pedal.
            arc.set(-.02, 1.2, -.72).multiplyScalar(size).applyQuaternion(frameQ).add(p);
            const u = swing;
            seated.copy(target);
            target.copy(standFeet[1]).multiplyScalar((1 - u) * (1 - u)).addScaledVector(arc, 2 * u * (1 - u)).addScaledVector(seated, u * u);
          }
        }
        upLeg.getWorldPosition(pole);
        pole.addScaledVector(forward, .55 * size).addScaledVector(up, .12 * size).addScaledVector(left, side * .07 * size);
        reach(upLeg, leg, foot, target, pole);
        // Point the foot along the pedal: ankle → ball in the bicycle's frame.
        offset.set(0, -.098, .115).applyAxisAngle(X, side === 1 ? pitch * (1 - state.footDown) : pitch).applyQuaternion(frameQ);
        foot.getWorldPosition(scratch); toe.getWorldPosition(look);
        delta.setFromUnitVectors(look.sub(scratch).normalize(), offset.normalize());
        if (mounting && side === -1 && swing < 1) delta.slerp(rootQ.identity(), 1 - swing * swing);
        turnWorld(foot, delta);
      }

      // Arms: hands on the grips, wherever the bars are turned; elbows soft
      // and out to the sides.
      for (const side of [1, -1] as const) {
        const [arm, foreArm, hand] = side === 1 ? [b.LeftArm, b.LeftForeArm, b.LeftHand] : [b.RightArm, b.RightForeArm, b.RightHand];
        gripWorld(bike, side, point);
        target.copy(point).addScaledVector(up, .02 * size).addScaledVector(forward, -.05 * size).addScaledVector(left, -side * .01 * size);
        if (mounting) target.lerpVectors(standHands[side === 1 ? 0 : 1], seated.copy(target), grip);
        arm.getWorldPosition(pole);
        pole.addScaledVector(left, side * .3 * size).addScaledVector(forward, -.18 * size).addScaledVector(up, -.25 * size);
        reach(arm, foreArm, hand, target, pole);
      }

      // Eyes on the road a few metres ahead, glancing into turns.
      look.copy(forward).multiplyScalar(Math.cos(.16)).addScaledVector(up, -Math.sin(.16)).applyAxisAngle(up, state.turn * .3);
      turnFace(b.neck, look, .45 * grip);
      turnFace(b.Head, look, .3 + .7 * grip);

      buffer.blend(weight);
      root.updateMatrixWorld(true);
    },
  };
}
export type Rider = ReturnType<typeof createRider>;
