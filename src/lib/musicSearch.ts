export type MusicSearchResult = {
  id: string;
  title: string;
  artist: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl: string;
  youtubeMusicUrl: string;
};

export async function searchYouTubeMusic(
  query: string,
  signal: AbortSignal,
): Promise<MusicSearchResult[]> {
  const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(
    /\/+$/,
    "",
  );
  const apiBaseUrl =
    configuredApiBaseUrl ||
    (import.meta.env.BASE_URL === "/Tweak-Music-App/"
      ? "https://tweak-music-api.onrender.com"
      : "");
  const endpoint = apiBaseUrl
    ? `${apiBaseUrl}/api/music/search`
    : "/api/music/search";
  let response: Response;
  try {
    response = await fetch(
      `${endpoint}?q=${encodeURIComponent(query)}`,
      { signal },
    );
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new Error(
      apiBaseUrl
        ? "The music search service is unavailable. Please try again later."
        : "Music search API is unavailable. Restart Tweak with `npm run dev` and try again.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new Error(
        apiBaseUrl
          ? "The music search service is not responding. Please try again later."
          : "Music search API is not responding. Restart Tweak with `npm run dev` and try again.",
      );
    }
    throw new Error("Music search returned an unexpected response.");
  }

  let result: { results?: MusicSearchResult[]; error?: string };
  try {
    result = (await response.json()) as {
      results?: MusicSearchResult[];
      error?: string;
    };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new Error("Music search returned an incomplete response. Please try again.");
  }

  if (!response.ok) {
    throw new Error(result.error ?? "Music search is unavailable.");
  }
  if (!Array.isArray(result.results)) {
    throw new Error("Music search returned an invalid response.");
  }

  return result.results;
}
