
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { Callbacks, type Room } from "@colyseus/sdk";
import { LOOKS, type Fleet, type Bike } from "./bicycle";

type PlayerData = {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  animation: string;
  name: string;
};

type RemotePlayer = {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  currentAnimation: string;
  data: PlayerData;
  targetPosition: THREE.Vector3;
  targetQuaternion: THREE.Quaternion;
  bicycle: Bike;
  riding: boolean;
};

export type RemotePlayers = {
  update: (delta: number) => void;
  dispose: () => void;
};

export function createRemotePlayers(
  scene: THREE.Scene,
  room: Room,
  sourceModel: THREE.Object3D,
  clips: THREE.AnimationClip[],
  fleet: Fleet,
): RemotePlayers {
  const players = new Map<string, RemotePlayer>();
  const callbacks = Callbacks.get(room);
  let disposed = false;

  function setAnimation(player: RemotePlayer, name: string) {
    const requested = player.actions[name] ? name : "Idle";
    if (requested === player.currentAnimation) return;
    player.actions[player.currentAnimation]?.fadeOut(0.15);
    player.actions[requested]?.reset().fadeIn(0.15).play();
    player.currentAnimation = requested;
  }

  function addPlayer(data: PlayerData, sessionId: string) {
    if (disposed || sessionId === room.sessionId || players.has(sessionId)) return;

    const model = clone(sourceModel);
    const root = new THREE.Group();
    root.add(model);

    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.frustumCulled = false;
      }
    });

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of clips) actions[clip.name] = mixer.clipAction(clip);

    const bicycle = fleet.add(
      LOOKS[0],
      new THREE.Vector3(data.x, data.y, data.z),
      0,
    );
    bicycle.visible = false;

    const player: RemotePlayer = {
      root,
      model,
      mixer,
      actions,
      currentAnimation: "",
      data,
      targetPosition: new THREE.Vector3(data.x, data.y, data.z),
      targetQuaternion: new THREE.Quaternion(data.qx, data.qy, data.qz, data.qw),
      bicycle,
      riding: false,
    };

    root.position.copy(player.targetPosition);
    root.quaternion.copy(player.targetQuaternion);
    scene.add(root);
    players.set(sessionId, player);
    setAnimation(player, data.animation || "Idle");
  }

  function removePlayer(_data: PlayerData, sessionId: string) {
    const player = players.get(sessionId);
    if (!player) return;

    scene.remove(player.root);
    player.mixer.stopAllAction();
    player.mixer.uncacheRoot(player.model);
    player.bicycle.visible = false;
    players.delete(sessionId);
  }

  callbacks.onAdd("players", (data, sessionId) =>
    addPlayer(data as PlayerData, String(sessionId)),
  );

  callbacks.onRemove("players", (data, sessionId) =>
    removePlayer(data as PlayerData, String(sessionId)),
  );

  return {
    update(delta) {
      if (disposed) return;

      const alpha = 1 - Math.exp(-12 * delta);

      for (const player of players.values()) {
        const data = player.data;

        player.targetPosition.set(data.x, data.y, data.z);
        player.targetQuaternion.set(data.qx, data.qy, data.qz, data.qw);

        player.root.position.lerp(player.targetPosition, alpha);
        player.root.quaternion.slerp(player.targetQuaternion, alpha);

        const animation = data.animation || "Idle";
        setAnimation(player, animation);

        const riding = animation === "Ride";
        player.bicycle.visible = riding;

        if (riding !== player.riding) {
          player.riding = riding;
          player.model.position.y = 0;
          player.model.rotation.z = 0;
        }

        player.bicycle.position.copy(player.root.position);
        player.bicycle.heading = player.root.rotation.y;
        player.mixer.update(delta);
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;

      for (const player of players.values()) {
        scene.remove(player.root);
        player.mixer.stopAllAction();
        player.mixer.uncacheRoot(player.model);
        player.bicycle.visible = false;
      }

      players.clear();
    },
  };
}
