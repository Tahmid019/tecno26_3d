import { Client, Room } from "@colyseus/sdk";

export type PlayerSnapshot = {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  animation: string;
};

let client: Client | null = null;
let room: Room | null = null;
let joining: Promise<Room> | null = null;

const SERVER_URL =
  process.env.NEXT_PUBLIC_MULTIPLAYER_URL ||
  "http://192.168.1.4:2567";

export function getRoom() {
  return room;
}

export async function joinCampus(name = "Guest"): Promise<Room> {
  if (room) return room;
  if (joining) return joining;

  joining = (async () => {
    client ??= new Client(SERVER_URL);

    try {
      const joined = await client.joinOrCreate("campus", { name });
      room = joined;

      joined.onLeave(() => {
        if (room === joined) room = null;
      });

      joined.onError((code, message) => {
        console.error("[Multiplayer] Room error:", code, message);
      });

      console.info("[Multiplayer] Joined campus:", joined.sessionId);

      return joined;
    } catch (error) {
      console.error("[Multiplayer] Failed to join campus:", error);
      throw error;
    } finally {
      joining = null;
    }
  })();

  return joining;
}

export function sendPlayerMovement(snapshot: PlayerSnapshot) {
  if (!room) return;
  room.send("move", snapshot);
}

export async function leaveCampus() {
  const current = room;
  room = null;

  if (current) await current.leave();
}