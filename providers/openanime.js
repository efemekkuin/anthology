/**
 * Nuvio / Anthology Provider: OpenAnime
 * Translated from Python OpenAnime Scraper (Working Core + Anizium Subtitles)
 */

const API_BASE = "https://api.openani.me";
const MAIN_URL = "https://openani.me";
const PROTOCOL_MODEL = "RCSA-14402/05";
const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023"; // Anizium kodundaki public key

const DEFAULT_HEADERS = {
    "Client-Protocol-Model": PROTOCOL_MODEL,
    "Origin": MAIN_URL,
    "Referer": MAIN_URL + "/",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
};

let _cdnHost = null;

// --- YARDIMCI FONKSİYONLAR ---

async function openAnimeFetch(endpoint, params = {}) {
    let url = API_BASE + endpoint;
    const keys = Object.keys(params);
    if (keys.length > 0) {
        url += "?" + keys.map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k])).join("&");
    }
    try {
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function getCdnHost() {
    if (_cdnHost) return _cdnHost;
    try {
        const res = await fetch(MAIN_URL + "/__data.json", { headers: { "Referer": MAIN_URL + "/" } });
        const text = await res.text();
        const m = text.match(/"(https:\/\/[^"]+\.eu\.org)"/);
        if (m) {
            _cdnHost = m[1].replace(/\/$/, "");
            return _cdnHost;
        }
    } catch (e) {}
    _cdnHost = "https://de2---vn-t9g4tsan-5qcl.yeshi.eu.org";
    return _cdnHost;
}

// Nuvio TMDB id yollarsa, adını bulup OpenAnime'de slug aramak için
async function resolveSlugFromId(rawId, mediaType) {
    if (rawId.startsWith("openanime:slug:")) {
        return rawId.split(":")[2];
    }
    
    // TMDB Araması
    let cleanId = rawId.split(":")[0];
    let query = "";
    
    try {
        if (cleanId.startsWith("tt")) {
            const findRes = await fetch(`https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
            const fData = await findRes.json();
            const item = (mediaType === "tv" || mediaType === "series") ? fData.tv_results?.[0] : fData.movie_results?.[0];
            query = item?.name || item?.title || item?.original_name;
        } else {
            const type = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
            const res = await fetch(`https://api.themoviedb.org/3/${type}/${cleanId}?api_key=${TMDB_API_KEY}`);
            const data = await res.json();
            query = data.name || data.title || data.original_name;
        }
        
        if (!query) return null;
        
        // OpenAnime'de Ara
        const searchData = await openAnimeFetch("/anime/search", { q: query });
        const items = searchData?.animes || searchData || [];
        if (items.length > 0 && items[0].slug) {
            return items[0].slug;
        }
    } catch (e) {
        return null;
    }
    return null;
}

// --- ANA NUVIO ARAYÜZLERİ (API) ---

async function getCatalog(args) {
    try {
        const data = await openAnimeFetch("/anime?page=1");
        const items = data?.animes || [];
        const metas = items.map(item => ({
            id: "openanime:slug:" + item.slug,
            type: item.type === "movie" ? "movie" : "series",
            name: item.romaji || item.name || "Anime",
            poster: item.pictures?.avatar || item.pictures?.banner,
            background: item.pictures?.banner || item.pictures?.avatar,
            description: "OpenAnime Kaynağı",
            genres: ["Anime"]
        }));
        return { metas };
    } catch (e) {
        return { metas: [] };
    }
}

async function getMeta(args) {
    try {
        const rawId = typeof args === "string" ? args : (args?.id || "");
        const slug = await resolveSlugFromId(rawId, "series");
        if (!slug) return { meta: null };

        const d = await openAnimeFetch("/anime/" + slug);
        if (!d) return { meta: null };

        const videos = [];
        const seasons = d.seasons || [];
        
        for (const s of seasons) {
            const sNum = s.season_number || s.tmdb_season_number || 1;
            if (s.hasEpisode === false || sNum <= 0) continue;
            
            const sData = await openAnimeFetch(`/anime/${slug}/season/${sNum}`);
            const eps = sData?.season?.episodes || [];
            eps.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
            
            for (const ep of eps) {
                const eNum = ep.episodeNumber;
                videos.push({
                    id: `openanime:ep:${slug}:${sNum}:${eNum}`,
                    title: `${sNum}. Sezon ${eNum}. Bölüm` + (ep.name ? ` - ${ep.name}` : ""),
                    season: sNum,
                    episode: eNum
                });
            }
        }

        return {
            meta: {
                id: `openanime:slug:${slug}`,
                type: d.type === "movie" ? "movie" : "series",
                name: d.romaji || d.name,
                poster: d.pictures?.avatar,
                background: d.pictures?.banner,
                description: d.synopsis || "OpenAnime İçeriği",
                videos: videos.length > 0 ? videos : undefined
            }
        };
    } catch (e) {
        return { meta: null };
    }
}

async function getStreams(id, mediaType, season, episode) {
    try {
        let slug = null;
        let sNum = parseInt(season) || 1;
        let eNum = parseInt(episode) || 1;

        if (String(id).startsWith("openanime:ep:")) {
            const parts = String(id).split(":");
            slug = parts[2];
            sNum = parseInt(parts[3]);
            eNum = parseInt(parts[4]);
        } else {
            slug = await resolveSlugFromId(id, mediaType);
        }

        if (!slug) return [];

        const cdnHost = await getCdnHost();
        const baseEpUrl = `/anime/${slug}/season/${sNum}/episode/${eNum}`;
        const initial = await openAnimeFetch(baseEpUrl);
        if (!initial) return [];

        let fansubs = initial.fansubs || [];
        const firstEpData = initial.episodeData || {};
        
        if (fansubs.length === 0 && firstEpData.fansub) {
            fansubs = [firstEpData.fansub];
        }

        const streams = [];

        for (const f of fansubs) {
            const fId = f.id;
            let epData = firstEpData;
            
            // Eğer verisi çekilmemiş bir fansub ise istek at
            if (firstEpData?.fansub?.id !== fId) {
                const fRes = await openAnimeFetch(baseEpUrl, { fansub: fId });
                epData = fRes?.episodeData || {};
            }

            const secName = f.secureName || "";
            const files = epData.files || [];
            const fName = f.name || secName || "Varsayılan";

            // Altyazıları bu aşamada toplayıp video objesine gömüyoruz
            let epSubtitles = [];
            if (secName && f.is4K) {
                for (const ext of ["vtt", "srt"]) {
                    const subUrl = `${API_BASE}/anime/${slug}/season/${sNum}/episode/${eNum}/subtitles/${secName}?type=${ext}`;
                    epSubtitles.push({
                        id: `openanime_${secName}_${ext}`,
                        url: subUrl,
                        file: subUrl,
                        link: subUrl,
                        lang: "tur",
                        language: "tr",
                        label: `${fName} (${ext.toUpperCase()})`,
                        name: `${fName} (${ext.toUpperCase()})`,
                        title: `${fName} (${ext.toUpperCase()})`,
                        format: ext,
                        type: `text/${ext}`,
                        mimeType: `text/${ext}`,
                        headers: {
                            "Referer": MAIN_URL + "/",
                            "User-Agent": DEFAULT_HEADERS["User-Agent"]
                        }
                    });
                }
            }

            for (const fileObj of files) {
                const relFile = String(fileObj.file || "").replace(/^\/+/, "");
                if (!relFile) continue;

                const fullUrl = `${cdnHost}/animes/${slug}/${sNum}/${relFile}`;
                const resLabel = fileObj.resolution ? `${fileObj.resolution}p` : "Auto";
                const isHls = fullUrl.toLowerCase().includes(".m3u8");

                streams.push({
                    name: "OpenAnime",
                    title: `[${fName}] ${resLabel}`,
                    url: fullUrl,
                    quality: resLabel,
                    format: isHls ? "hls" : "mp4",
                    isHls: isHls,
                    behaviorHints: { notWebReady: false },
                    headers: {
                        "Referer": MAIN_URL + "/",
                        "User-Agent": DEFAULT_HEADERS["User-Agent"]
                    },
                    subtitles: epSubtitles.length > 0 ? epSubtitles : undefined
                });
            }
        }
        return streams;
    } catch (e) {
        return [];
    }
}

async function getSubtitles(id, mediaType, season, episode) {
    try {
        let slug = null;
        let sNum = parseInt(season) || 1;
        let eNum = parseInt(episode) || 1;

        if (String(id).startsWith("openanime:ep:")) {
            const parts = String(id).split(":");
            slug = parts[2];
            sNum = parseInt(parts[3]);
            eNum = parseInt(parts[4]);
        } else {
            slug = await resolveSlugFromId(id, mediaType);
        }

        if (!slug) return { subtitles: [] };

        const baseEpUrl = `/anime/${slug}/season/${sNum}/episode/${eNum}`;
        const initial = await openAnimeFetch(baseEpUrl);
        if (!initial) return { subtitles: [] };

        let fansubs = initial.fansubs || [];
        const firstEpData = initial.episodeData || {};
        
        if (fansubs.length === 0 && firstEpData.fansub) {
            fansubs = [firstEpData.fansub];
        }

        let allSubtitles = [];

        for (const f of fansubs) {
            const secName = f.secureName || "";
            const fName = f.name || secName || "Varsayılan";
            
            if (secName && f.is4K) {
                for (const ext of ["vtt", "srt"]) {
                    const subUrl = `${API_BASE}/anime/${slug}/season/${sNum}/episode/${eNum}/subtitles/${secName}?type=${ext}`;
                    allSubtitles.push({
                        id: `openanime_${secName}_${ext}`,
                        url: subUrl,
                        file: subUrl,
                        link: subUrl,
                        lang: "tur",
                        language: "tr",
                        label: `${fName} (${ext.toUpperCase()})`,
                        name: `${fName} (${ext.toUpperCase()})`,
                        title: `${fName} (${ext.toUpperCase()})`,
                        format: ext,
                        type: `text/${ext}`,
                        mimeType: `text/${ext}`,
                        headers: {
                            "Referer": MAIN_URL + "/",
                            "User-Agent": DEFAULT_HEADERS["User-Agent"]
                        }
                    });
                }
            }
        }

        return { subtitles: allSubtitles };
    } catch (e) {
        return { subtitles: [] };
    }
}

// Nuvio'nun bu fonksiyonları dışarıdan çağırabilmesi için global objelere atıyoruz.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams, getCatalog, getMeta, getSubtitles };
}
if (typeof globalThis !== "undefined") {
    globalThis.getStreams = getStreams;
    globalThis.getCatalog = getCatalog;
    globalThis.getMeta = getMeta;
    globalThis.getSubtitles = getSubtitles;
}
