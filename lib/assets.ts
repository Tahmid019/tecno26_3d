/**
 * Streaming asset downloads with a real percentage.
 *
 * The campus is fetched in two stages: everything needed to stand up and walk,
 * then the library in the background. Progress is measured from the bytes that
 * actually arrive, so the number on screen is the download, not a guess.
 */
export type Stage = 'campus' | 'outer';

/** Approximate sizes, only used to weight the bar before headers arrive. */
const EXPECTED: Record<string, number> = {
  '/assets/campus.glb': 2_100_000,
  '/assets/collision.glb': 2_150_000,
  '/assets/student.glb': 2_320_000,
  '/assets/trees.json': 65_000,
  '/assets/library.glb': 1_204_036,
  '/assets/library-collision.glb': 169_996,
  '/assets/gallery.glb': 1_623_832,
  '/assets/gallery-collision.glb': 484_084,
};

export const STAGES: Record<Stage, string[]> = {
  campus: ['/assets/campus.glb', '/assets/collision.glb', '/assets/student.glb', '/assets/trees.json'],
  outer: ['/assets/library.glb', '/assets/library-collision.glb',
    '/assets/gallery.glb', '/assets/gallery-collision.glb'],
};

export type Progress = Record<Stage, number>;
export type Downloader = { get(url: string): Promise<ArrayBuffer> };

export function createDownloader(onProgress: (progress: Progress) => void): Downloader {
  const size = new Map(Object.entries(EXPECTED));
  const received = new Map<string, number>();
  const finished = new Set<string>();

  const percent = (stage: Stage) => {
    let total = 0, loaded = 0;
    for (const url of STAGES[stage]) {
      total += size.get(url) ?? 0;
      loaded += finished.has(url) ? (size.get(url) ?? 0) : (received.get(url) ?? 0);
    }
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round(loaded / total * 100)));
  };

  const report = () => onProgress({ campus: percent('campus'), outer: percent('outer') });

  return {
    async get(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url.split('/').pop()} could not be downloaded (${response.status}).`);
      const declared = Number(response.headers.get('x-uncompressed-length'))
        || Number(response.headers.get('content-length'));
      if (declared > 0) size.set(url, declared);
      if (!response.body) {
        const whole = await response.arrayBuffer();
        finished.add(url); report();
        return whole;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let count = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        count += value.length;
        // A gzipped response reports the compressed length; never run past it.
        if (count > (size.get(url) ?? 0)) size.set(url, count);
        received.set(url, count);
        report();
      }
      finished.add(url); report();
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes.buffer;
    },
  };
}
