import Dexie, { type Table } from "dexie";

export type LocalAudioRecord = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  fileName: string;
  mimeType: string;
  file: Blob;
  createdAt: number;
};

class TweakDatabase extends Dexie {
  localTracks!: Table<LocalAudioRecord, string>;

  constructor() {
    super("tweak-music");
    this.version(1).stores({
      localTracks: "id, title, artist, createdAt",
    });
  }
}

const database = new TweakDatabase();

export async function listLocalTracks(): Promise<LocalAudioRecord[]> {
  return database.localTracks.orderBy("createdAt").reverse().toArray();
}

export async function importAudioFiles(
  files: readonly File[],
): Promise<{ added: LocalAudioRecord[]; failures: string[] }> {
  const added: LocalAudioRecord[] = [];
  const failures: string[] = [];

  for (const file of files) {
    if (!/\.(?:mp3|flac|wav)$/i.test(file.name)) {
      failures.push(`${file.name}: Choose an MP3, FLAC, or WAV file.`);
      continue;
    }

    try {
      const { parseBlob } = await import("music-metadata");
      const metadata = await parseBlob(file);
      const record: LocalAudioRecord = {
        id: `local-${crypto.randomUUID()}`,
        title: metadata.common.title?.trim() || file.name.replace(/\.[^.]+$/, ""),
        artist: metadata.common.artist?.trim() || "Unknown artist",
        album: metadata.common.album?.trim() || "",
        duration: Number.isFinite(metadata.format.duration)
          ? Math.max(0, metadata.format.duration ?? 0)
          : 0,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        file,
        createdAt: Date.now(),
      };
      await database.localTracks.add(record);
      added.push(record);
    } catch (error) {
      failures.push(
        `${file.name}: ${
          error instanceof Error ? error.message : "The file could not be read."
        }`,
      );
    }
  }

  return { added, failures };
}

export async function getLocalTrack(id: string): Promise<LocalAudioRecord | undefined> {
  return database.localTracks.get(id);
}

export async function saveLocalTrackMetadata(
  id: string,
  title: string,
  artist: string,
  album: string,
): Promise<LocalAudioRecord> {
  const record = await database.localTracks.get(id);
  if (!record) {
    throw new Error("This local track is no longer in your library.");
  }

  const updated = {
    ...record,
    title: title.trim(),
    artist: artist.trim(),
    album: album.trim(),
  };
  await database.localTracks.put(updated);
  return updated;
}

export async function removeLocalTrack(id: string): Promise<void> {
  await database.localTracks.delete(id);
}
