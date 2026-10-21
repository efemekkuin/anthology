/**
 * Anthology Provider: OpenAnime (Final Subtitle & Performance Fix)
 */

const API_BASE = "https://api.openani.me";
const MAIN_URL = "https://openani.me";
const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023";
const DEFAULT_HEADERS = {
    "Client-Protocol-Model": "RCSA-14402/05",
    "Origin": MAIN_URL,
    "Referer": MAIN_URL + "/",
    "Accept": "application/json"
};

let _cdnHost = "https://de2---vn-t9g4tsan-5qcl.yeshi.eu.org";

async function openAnimeFetch(endpoint) {
    try {
        const res = await fetch(API_BASE + endpoint, { headers: DEFAULT_HEADERS });
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

async function resolveSlug(rawId, type) {
    if (String(rawId).startsWith("openanime:slug:")) return String(rawId).split(":")[2];
    let cleanId = String(rawId).split(":")[0];
    try {
        const url = cleanId.startsWith("tt") 
            ? `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
            : `https://api.themoviedb.org/3/${type === "movie" ? "movie" : "tv"}/${cleanId}?api_key=${TMDB_API_KEY}`;
        const data = await (await fetch(url)).json();
        const query = data.name || data.title || data.original_name || data.tv_results?.[0]?.name || data.movie_results?.[0]?.title;
        if (!query) return null;
        
        const search = await openAnimeFetch(`/anime/search?q=${encodeURIComponent(query)}`);
        return search?.animes?.[0]?.slug || search?.[0]?.slug || null;
    } catch { return null; }
}

async function getCatalog() {
    const data = await openAnimeFetch("/anime?page=1");
    const metas = (data?.animes || []).map(item => ({
        id: "openanime:slug:" + item.slug,
        type: item.type === "movie" ? "movie" : "series",
        name: item.romaji || item.name,
        poster: item.pictures?.avatar || item.pictures?.banner,
        background: item.pictures?.banner || item.pictures?.avatar,
        description: "OpenAnime Hızlı Kaynak"
    }));
    return { metas };
}

async function getMeta(args) {
    const rawId = typeof args === "string" ? args : args?.id;
    const slug = await resolveSlug(rawId, "series");
    if (!slug) return { meta: null };

    const d = await openAnimeFetch("/anime/" + slug);
    if (!d) return { meta: null };

    const videos = [];
    for (const s of d.seasons || []) {
        const sNum = s.season_number || s.tmdb_season_number || 1;
        if (sNum <= 0 || s.hasEpisode === false) continue;
        const sData = await openAnimeFetch(`/anime/${slug}/season/${sNum}`);
        for (const ep of sData?.season?.episodes || []) {
            videos.push({
                id: `openanime:ep:${slug}:${sNum}:${ep.episodeNumber}`,
                title: `${sNum}. Sezon ${ep.episodeNumber}. Bölüm`,
                season: sNum,
                episode: ep.episodeNumber
            });
        }
    }
    return { meta: { id: `openanime:slug:${slug}`, type: d.type === "movie" ? "movie" : "series", name: d.romaji || d.name, poster: d.pictures?.avatar, videos } };
}

async function getStreams(id, mediaType, season, episode) {
    let slug = null, sNum = parseInt(season) || 1, eNum = parseInt(episode) || 1;
    if (String(id).startsWith("openanime:ep:")) {
        const p = String(id).split(":");
        slug = p[2]; sNum = p[3]; eNum = p[4];
    } else {
        slug = await resolveSlug(id, mediaType);
    }
    if (!slug) return [];

    const d = await openAnimeFetch(`/anime/${slug}/season/${sNum}/episode/${eNum}`);
    if (!d || !d.episodeData) return [];

    const f = d.episodeData.fansub || {};
    const fName = f.name || "Varsayılan";
    const secName = f.secureName;
    const is4K = f.is4K;
    const files = d.episodeData.files || [];
    
    let epSubtitles = [];
    if (secName && is4K) {
        for (const ext of ["vtt", "srt"]) {
            const subUrl = `${API_BASE}/anime/${slug}/season/${sNum}/episode/${eNum}/subtitles/${secName}?type=${ext}`;
            epSubtitles.push({
                id: `oa_${secName}_${ext}`,
                url: subUrl,
                file: subUrl,
                link: subUrl,
                lang: "tur",
                language: "tr",
                label: `Türkçe (${ext.toUpperCase()})`,
                name: `Türkçe (${ext.toUpperCase()})`,
                title: `Türkçe (${ext.toUpperCase()})`,
                format: ext,
                type: `text/${ext}`,
                mimeType: `text/${ext}`
            });
        }
    }

    return files.map(fileObj => {
        const url = `${_cdnHost}/animes/${slug}/${sNum}/${String(fileObj.file).replace(/^\/+/, "")}`;
        return {
            name: "OpenAnime",
            title: `[${fName}] ${fileObj.resolution ? fileObj.resolution + 'p' : 'Auto'}`,
            url: url,
            format: url.includes(".m3u8") ? "hls" : "mp4",
            isHls: url.includes(".m3u8"),
            subtitles: epSubtitles.length > 0 ? epSubtitles : undefined
        };
    });
}

async function getSubtitles(id, mediaType, season, episode) {
    let slug = null, sNum = parseInt(season) || 1, eNum = parseInt(episode) || 1;
    if (String(id).startsWith("openanime:ep:")) {
        const p = String(id).split(":");
        slug = p[2]; sNum = p[3]; eNum = p[4];
    } else {
        slug = await resolveSlug(id, mediaType);
    }
    if (!slug) return { subtitles: [] };

    const d = await openAnimeFetch(`/anime/${slug}/season/${sNum}/episode/${eNum}`);
    const secName = d?.episodeData?.fansub?.secureName;
    const is4K = d?.episodeData?.fansub?.is4K;
    
    if (!secName || !is4K) return { subtitles: [] };

    let subtitles = [];
    for (const ext of ["vtt", "srt"]) {
        const subUrl = `${API_BASE}/anime/${slug}/season/${sNum}/episode/${eNum}/subtitles/${secName}?type=${ext}`;
        subtitles.push({
            id: `oa_${secName}_${ext}`,
            url: subUrl,
            file: subUrl,
            link: subUrl,
            lang: "tur",
            language: "tr",
            label: `Türkçe (${ext.toUpperCase()})`,
            name: `Türkçe (${ext.toUpperCase()})`,
            title: `Türkçe (${ext.toUpperCase()})`,
            format: ext,
            type: `text/${ext}`,
            mimeType: `text/${ext}`
        });
    }

    return { subtitles };
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, getCatalog, getMeta, getSubtitles };
if (typeof globalThis !== "undefined") { globalThis.getStreams = getStreams; globalThis.getCatalog = getCatalog; globalThis.getMeta = getMeta; globalThis.getSubtitles = getSubtitles; }
