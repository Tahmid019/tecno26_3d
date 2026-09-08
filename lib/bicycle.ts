import * as THREE from 'three';

/**
 * A campus bicycle, built in code rather than downloaded: the whole point is a
 * faster way across the grounds, so it must not cost another asset fetch.
 *
 * The frame is built around the rider, not the other way round. `createBicycle`
 * takes the seat, grip and pedal-circle positions measured from the character's
 * own cycling clip, so the hands land on the bars and the feet on the cranks
 * without bending a single bone.
 */
export const BICYCLE_SPEED = 9.6;
export const BICYCLE_SPRINT = 14.5;
/** How close the student has to be, in metres, before it can be picked up. */
export const MOUNT_RANGE = 3.2;

export type RiderFit = {
  /** Bottom bracket, in the rider's own frame; the rider faces +Z. */
  crank: { y: number; z: number };
  /** Radius of the circle the feet travel through. */
  crankRadius: number;
  /** One handlebar grip; x is the half width. */
  bar: { x: number; y: number; z: number };
  saddle: { y: number; z: number };
};

export type Bicycle = ReturnType<typeof createBicycle>;

export function createBicycle(fit: RiderFit) {
  const group = new THREE.Group();
  group.name = 'Campus bicycle';
  const body = new THREE.Group();          // leans; the shadow stays flat
  group.add(body);

  const frame = new THREE.MeshStandardMaterial({ color: '#1f6f63', roughness: .35, metalness: .55 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#191b1a', roughness: .92 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#b9c3c6', roughness: .3, metalness: .8 });
  const saddleSkin = new THREE.MeshStandardMaterial({ color: '#22262a', roughness: .7 });
  const materials = [frame, rubber, chrome, saddleSkin];

  const tube = (a: number[], b: number[], radius: number, material: THREE.Material) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const span = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, span.length(), 8), material);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
    mesh.position.copy(start).addScaledVector(span, .5);
    body.add(mesh);
    return mesh;
  };

  // Everything hangs off the measured anchors. Wheels sit on y = 0, and the
  // front is wherever the rider's hands are relative to their hips.
  const facing = Math.sign(fit.bar.z - fit.saddle.z) || 1;
  const wheelRadius = THREE.MathUtils.clamp(fit.crank.y + .07, .27, .38);
  const crank = [0, fit.crank.y, fit.crank.z];
  const seat = [0, fit.saddle.y - .05, fit.saddle.z];
  const head = [0, fit.bar.y - .11, fit.bar.z - facing * .02];
  const front = [0, wheelRadius, fit.bar.z + facing * .12];
  const rear = [0, wheelRadius, fit.saddle.z - facing * .44];

  const wheels: THREE.Group[] = [];
  for (const centre of [front, rear]) {
    const wheel = new THREE.Group();
    wheel.position.set(0, centre[1], centre[2]);
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, .034, 6, 22), rubber);
    tyre.rotation.y = Math.PI / 2;
    wheel.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .09, 8), chrome);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    for (let i = 0; i < 8; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, wheelRadius * 2 - .04, 4), chrome);
      spoke.rotation.set(i * Math.PI / 8, Math.PI / 2, 0);
      wheel.add(spoke);
    }
    body.add(wheel);
    wheels.push(wheel);
  }

  tube(rear, crank, .022, frame);             // chain stay
  tube(rear, seat, .024, frame);              // seat stay
  tube(crank, seat, .028, frame);             // seat tube
  tube(crank, head, .030, frame);             // down tube
  tube(seat, head, .028, frame);              // top tube
  tube(head, [0, wheelRadius + .06, front[2]], .022, chrome);   // fork
  tube(head, [0, fit.bar.y, fit.bar.z], .022, chrome);          // stem
  const bars = tube([-fit.bar.x, fit.bar.y, fit.bar.z], [fit.bar.x, fit.bar.y, fit.bar.z], .018, chrome);
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(.021, .021, .1, 8), saddleSkin);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * (fit.bar.x - .05), fit.bar.y, fit.bar.z);
    body.add(grip);
  }

  const saddle = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 6), saddleSkin);
  saddle.scale.set(.62, .26, 1);
  saddle.position.set(0, fit.saddle.y - .03, fit.saddle.z);
  body.add(saddle);

  // The cranks are driven by the rider's own feet, so they can never slip.
  const cranks = new THREE.Group();
  cranks.position.set(0, fit.crank.y, fit.crank.z);
  body.add(cranks);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.03, fit.crankRadius, .03), chrome);
    arm.position.set(side * .075, side * fit.crankRadius / 2, 0);
    cranks.add(arm);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(.085, .022, .13), saddleSkin);
    pedal.position.set(side * .105, side * fit.crankRadius, 0);
    pedal.userData.pedal = side;
    cranks.add(pedal);
  }
  const pedals = cranks.children.filter(child => child.userData.pedal);

  const rack = new THREE.Mesh(new THREE.BoxGeometry(.2, .02, .3), chrome);
  rack.position.set(0, fit.saddle.y - .18, fit.saddle.z - facing * .24);
  body.add(rack);

  body.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true; });

  let lean = 0;
  return {
    group, bars, pedals,
    /** Turn the cranks to match the rider's feet. */
    setCranks(angle: number) {
      cranks.rotation.x = angle;
      for (const pedal of pedals) pedal.rotation.x = -angle;
    },
    update(dt: number, speed: number, steer: number) {
      const spin = speed * dt / wheelRadius;
      for (const wheel of wheels) wheel.rotation.x -= spin;
      const wanted = THREE.MathUtils.clamp(-steer * Math.min(1, speed / 6) * .40, -.40, .40);
      lean += (wanted - lean) * (1 - Math.exp(-dt * 6));
      body.rotation.z = lean;
      return lean;
    },
    get lean() { return lean; },
    dispose() {
      group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      for (const material of materials) material.dispose();
    },
  };
}
