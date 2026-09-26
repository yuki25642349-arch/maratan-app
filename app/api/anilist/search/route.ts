import type { AniListSuggestion } from "../../../_data/anilist-types";

const SEARCH_QUERY = `query ($search: String!) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: ANIME, isAdult: false) {
      id
      title { native romaji english }
      format
      seasonYear
    }
  }
}`;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const length = [...query].length;
  if (length < 2) return Response.json({ suggestions: [] });
  if (length > 80) return Response.json({ error: "検索語が長すぎます。" }, { status: 400 });

  try {
    const upstream = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: query } }),
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (upstream.status === 429) {
      return Response.json(
        { error: "AniListの利用制限中です。少し待って再検索してください。" },
        { status: 429, headers: { "Retry-After": upstream.headers.get("Retry-After") ?? "60" } },
      );
    }
    if (!upstream.ok) return Response.json({ error: "AniListを利用できません。" }, { status: 502 });

    const result: unknown = await upstream.json();
    if (typeof result !== "object" || result === null || !("data" in result)) {
      return Response.json({ error: "AniListの応答を読み取れません。" }, { status: 502 });
    }
    const media = (result as { data?: { Page?: { media?: unknown } }; errors?: unknown[] }).data?.Page?.media;
    if (!Array.isArray(media)) return Response.json({ error: "AniListの応答を読み取れません。" }, { status: 502 });

    const suggestions = media.filter((item): item is AniListSuggestion =>
      typeof item === "object" && item !== null &&
      Number.isSafeInteger(item.id) && item.id > 0 &&
      typeof item.title === "object" && item.title !== null &&
      [item.title.native, item.title.romaji, item.title.english].some((title) => typeof title === "string"),
    ).map((item) => ({
      id: item.id,
      title: item.title,
      format: typeof item.format === "string" ? item.format : null,
      seasonYear: Number.isInteger(item.seasonYear) ? item.seasonYear : null,
    }));
    return Response.json({ suggestions }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=120" } });
  } catch {
    return Response.json({ error: "AniListへの接続に失敗しました。" }, { status: 502 });
  }
}
