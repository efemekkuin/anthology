/**
 * Nuvio / Anthology Provider: OpenAnime
 * Altyazı desteği eklenmiş sürüm (Anizium mantığıyla) + mobil düzeltmeleri
 */

const API_BASE = "https://api.openani.me";
const MAIN_URL = "https://openani.me";
const PROTOCOL_MODEL = "RCSA-14402/05";
const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023";
const DEBUG = false; // true yaparsan episodeData yapısını konsola yazar
const INLINE_SUBS = true; // false yaparsan altyazıyı indirip çevirmeden direkt link verir

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
    "Client-Protocol-Model": PROTOCOL_MODEL,
    "Origin": MAIN_URL,
    "Referer": MAIN_URL + "/",
    "Accept": "application/json",
    "User-Agent": UA
};

let _cdnHost = null;

function log() {
    if (DEBUG && typeof console !== "undefined") console.log.apply(console, ["[OpenAnime]"].concat([].slice.call(arguments)));
}

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

async function resolveSlugFromId(rawId, mediaType) {
    rawId = String(rawId || "");
    if (rawId.startsWith("openanime:slug:")) return rawId.split(":")[2];

    let cleanId = rawId.split(":")[0];
    let query = "";

    try {
        const isTv = mediaType === "tv" || mediaType === "series";
        if (cleanId.startsWith("tt")) {
            const findRes = await fetch(`https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
            const fData = await findRes.json();
            const item = isTv ? fData.tv_results?.[0] : fData.movie_results?.[0];
            query = item?.name || item?.title || item?.original_name;
        } else {
            const type = isTv ? "tv" : "movie";
            const res = await fetch(`https://api.themoviedb.org/3/${type}/${cleanId}?api_key=${TMDB_API_KEY}`);
            const data = await res.json();
            query = data.name || data.title || data.original_name;
        }

        if (!query) return null;

        const searchData = await openAnimeFetch("/anime/search", { q: query });
        const items = searchData?.animes || searchData || [];
        if (items.length > 0 && items[0].slug) return items[0].slug;
    } catch (e) {
        return null;
    }
    return null;
}

// --- ALTYAZI MANTIĞI ---

const SUB_EXT_RE = /\.(vtt|srt|ass|ssa|sub)(\?|#|$)/i;

const LANG_MAP = {
    tr: { lang: "tur", label: "Türkçe" },
    tur: { lang: "tur", label: "Türkçe" },
    turkish: { lang: "tur", label: "Türkçe" },
    "türkçe": { lang: "tur", label: "Türkçe" },
    en: { lang: "eng", label: "İngilizce" },
    eng: { lang: "eng", label: "İngilizce" },
    english: { lang: "eng", label: "İngilizce" },
    ja: { lang: "jpn", label: "Japonca" },
    jp: { lang: "jpn", label: "Japonca" },
    de: { lang: "ger", label: "Almanca" },
    fr: { lang: "fre", label: "Fransızca" },
    es: { lang: "spa", label: "İspanyolca" },
    it: { lang: "ita", label: "İtalyanca" },
    ar: { lang: "ara", label: "Arapça" }
};

function mapLang(code, fallbackLabel) {
    const g = String(code || "").toLowerCase().trim();
    const hit = LANG_MAP[g] || LANG_MAP[g.split("-")[0]];
    if (hit) {
        const short = Object.keys(LANG_MAP).find(k => k.length === 2 && LANG_MAP[k] === hit) || g;
        return { id: short, lang: hit.lang, language: short, label: fallbackLabel || hit.label };
    }
    return { id: g || "unknown", lang: g || "und", language: g || "und", label: fallbackLabel || (g ? g.toUpperCase() : "Altyazı") };
}

function absolutize(rel, cdnHost, slug, sNum) {
    const r = String(rel || "").trim();
    if (!r) return null;
    if (/^https?:\/\//i.test(r)) return r;
    if (r.startsWith("//")) return "https:" + r;
    const clean = r.replace(/^\/+/, "");
    if (clean.startsWith("animes/")) return `${cdnHost}/${clean}`;
    return `${cdnHost}/animes/${slug}/${sNum}/${clean}`;
}

// --- MOBİL İÇİN: URL çözme + ASS/SRT -> VTT dönüştürme ---

// Hermes'te new URL(rel, base) güvenilir değil, elle çözüyoruz
function resolveUrl(rel, base) {
    if (/^https?:\/\//i.test(rel)) return rel;
    if (rel.startsWith("//")) return "https:" + rel;
    const m = String(base).match(/^(https?:\/\/[^\/]+)(\/[^?#]*)?/i);
    if (!m) return rel;
    const origin = m[1];
    if (rel.startsWith("/")) return origin + rel;
    const dir = (m[2] || "/").replace(/[^\/]*$/, "");
    return origin + dir + rel;
}

function pad(n, l) {
    n = String(n);
    while (n.length < l) n = "0" + n;
    return n;
}

// ASS zamanı (h:mm:ss.cc) -> VTT zamanı (hh:mm:ss.mmm)
function assTime(t) {
    const m = String(t).trim().match(/^(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!m) return "00:00:00.000";
    const ms = parseInt((m[4] + "00").substring(0, 3));
    return pad(m[1], 2) + ":" + pad(m[2], 2) + ":" + pad(m[3], 2) + "." + pad(ms, 3);
}

function assToVtt(text) {
    const lines = text.split(/\r?\n/);
    let fmt = null;
    const out = ["WEBVTT", ""];
    for (const line of lines) {
        if (/^Format:/i.test(line) && !fmt && /Start/i.test(line)) {
            fmt = line.replace(/^Format:\s*/i, "").split(",").map(s => s.trim().toLowerCase());
            continue;
        }
        if (!/^Dialogue:/i.test(line) || !fmt) continue;
        const parts = line.replace(/^Dialogue:\s*/i, "").split(",");
        const textIdx = fmt.indexOf("text");
        const sIdx = fmt.indexOf("start");
        const eIdx = fmt.indexOf("end");
        if (textIdx < 0 || sIdx < 0 || eIdx < 0) continue;
        const body = parts.slice(textIdx).join(",")
            .replace(/\{[^}]*\}/g, "")
            .replace(/\\N/g, "\n").replace(/\\n/g, "\n").replace(/\\h/g, " ")
            .trim();
        if (!body) continue;
        out.push(assTime(parts[sIdx]) + " --> " + assTime(parts[eIdx]));
        out.push(body);
        out.push("");
    }
    return out.join("\n");
}

function srtToVtt(text) {
    return "WEBVTT\n\n" + text.replace(/\r/g, "").replace(/(\d+:\d+:\d+),(\d+)/g, "$1.$2");
}

// Altyazıyı kendimiz indirip VTT data URI'ye çeviriyoruz
async function inlineSubtitles(list) {
    if (!INLINE_SUBS) return list;
    const result = [];
    for (const s of list) {
        if (!s || !s.url || /^data:/i.test(s.url) || /\.m3u8(\?|#|$)/i.test(s.url)) {
            result.push(s);
            continue;
        }
        try {
            const res = await fetch(s.url, { headers: { "Referer": MAIN_URL + "/", "User-Agent": UA } });
            if (!res.ok) { result.push(s); continue; }
            let text = await res.text();
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            let vtt;
            if (/^WEBVTT/.test(text.trim())) vtt = text;
            else if (/\[Script Info\]|\[Events\]/i.test(text)) vtt = assToVtt(text);
            else if (/-->/.test(text)) vtt = srtToVtt(text);
            else { result.push(s); continue; }
            result.push(Object.assign({}, s, {
                url: "data:text/vtt;charset=utf-8," + encodeURIComponent(vtt)
            }));
        } catch (e) {
            result.push(s);
        }
    }
    return result;
}

function formatSubtitles(raw) {
    const subs = [];
    const seen = {};
    raw.forEach((s, i) => {
        if (!s || !s.url || seen[s.url]) return;
        seen[s.url] = true;
        const info = mapLang(s.langCode, s.label);
        const isData = /^data:/i.test(s.url);
        const isVtt = isData || /\.vtt(\?|#|$)/i.test(s.url);
        const isSrt = !isData && /\.srt(\?|#|$)/i.test(s.url);
        const isAss = !isData && /\.(ass|ssa)(\?|#|$)/i.test(s.url);
        const isM3u8 = !isData && /\.m3u8(\?|#|$)/i.test(s.url);
        const format = isVtt ? "vtt" : isSrt ? "srt" : isAss ? "ass" : isM3u8 ? "m3u8" : "vtt";
        const mime = format === "vtt" ? "text/vtt" : format === "srt" ? "application/x-subrip" : format === "ass" ? "text/x-ssa" : "application/x-mpegURL";
        const label = s.label || info.label;
        subs.push({
            id: info.id + "_" + (i + 1),
            url: s.url,
            file: s.url,
            link: s.url,
            lang: info.lang,
            language: info.language,
            label,
            name: label,
            title: label,
            format,
            type: mime,
            mimeType: mime,
            headers: { "Referer": MAIN_URL + "/", "User-Agent": UA }
        });
    });
    return subs;
}

// 1) Bilinen alanlardan dene
function extractKnownSubs(obj, cdnHost, slug, sNum, out) {
    if (!obj || typeof obj !== "object") return;
    const keys = ["subtitles", "subtitle", "captions", "caption", "tracks", "subs", "textTracks"];
    for (const k of keys) {
        let v = obj[k];
        if (!v) continue;
        if (!Array.isArray(v)) v = typeof v === "object" && !v.file && !v.url ? Object.values(v) : [v];
        for (const t of v) {
            if (typeof t === "string") {
                const url = absolutize(t, cdnHost, slug, sNum);
                if (url) out.push({ url, label: null, langCode: guessLangFromUrl(url) });
            } else if (t && typeof t === "object") {
                const raw = t.file || t.url || t.link || t.src || t.path || t.href;
                const url = absolutize(raw, cdnHost, slug, sNum);
                if (!url) continue;
                out.push({
                    url,
                    label: t.label || t.name || t.title || null,
                    langCode: t.lang || t.language || t.code || t.group || guessLangFromUrl(url)
                });
            }
        }
    }
}

function guessLangFromUrl(url) {
    const m = String(url).toLowerCase().match(/[\/_.-](tr|tur|turkish|en|eng|english|ja|jp|de|fr|es|it|ar)[\/_.-]/);
    return m ? m[1] : "tr";
}

// 2) Alan adı bilinmiyorsa her yeri tara: .vtt/.srt/.ass ile biten string'ler
function deepScanSubs(node, cdnHost, slug, sNum, out, depth = 0) {
    if (depth > 6 || node == null) return;
    if (typeof node === "string") {
        if (SUB_EXT_RE.test(node)) {
            const url = absolutize(node, cdnHost, slug, sNum);
            if (url) out.push({ url, label: null, langCode: guessLangFromUrl(url) });
        }
        return;
    }
    if (Array.isArray(node)) {
        node.forEach(n => deepScanSubs(n, cdnHost, slug, sNum, out, depth + 1));
        return;
    }
    if (typeof node === "object") {
        Object.keys(node).forEach(k => deepScanSubs(node[k], cdnHost, slug, sNum, out, depth + 1));
    }
}

// 3) M3U8 master playlist içindeki altyazı track'leri
async function extractHlsSubs(masterUrl) {
    const out = [];
    try {
        const res = await fetch(masterUrl, { headers: { "Referer": MAIN_URL + "/", "User-Agent": UA } });
        if (!res.ok) return out;
        const text = await res.text();
        if (!text.includes("#EXT-X-MEDIA")) return out;
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (!line.startsWith("#EXT-X-MEDIA") || !/TYPE=SUBTITLES/i.test(line)) continue;
            const uri = (line.match(/URI="([^"]+)"/i) || [])[1];
            if (!uri) continue;
            const name = (line.match(/NAME="([^"]*)"/i) || [])[1] || null;
            const lang = (line.match(/LANGUAGE="([^"]*)"/i) || [])[1] || "tr";
            const url = resolveUrl(uri, masterUrl);
            out.push({ url, label: name, langCode: lang });
        }
    } catch (e) {}
    return out;
}

// --- ANA TOPLAMA FONKSİYONU (stream + altyazı birlikte) ---

async function collectEpisode(id, mediaType, season, episode) {
    let slug = null;
    let sNum = parseInt(season) || 1;
    let eNum = parseInt(episode) || 1;

    if (String(id).startsWith("openanime:ep:")) {
        const parts = String(id).split(":");
        slug = parts[2];
        sNum = parseInt(parts[3]) || 1;
        eNum = parseInt(parts[4]) || 1;
    } else {
        slug = await resolveSlugFromId(id, mediaType);
    }
    if (!slug) return { streams: [], subtitles: [] };

    const cdnHost = await getCdnHost();
    const baseEpUrl = `/anime/${slug}/season/${sNum}/episode/${eNum}`;
    const initial = await openAnimeFetch(baseEpUrl);
    if (!initial) return { streams: [], subtitles: [] };

    log("initial keys:", Object.keys(initial), "episodeData keys:", Object.keys(initial.episodeData || {}));

    let fansubs = initial.fansubs || [];
    const firstEpData = initial.episodeData || {};
    if (fansubs.length === 0 && firstEpData.fansub) fansubs = [firstEpData.fansub];

    const streams = [];
    const rawSubs = [];

    // Bölüm seviyesindeki altyazılar (fansub'a bağlı değilse)
    extractKnownSubs(initial, cdnHost, slug, sNum, rawSubs);

    for (const f of fansubs) {
        const fId = f.id;
        let epData = firstEpData;

        if (firstEpData?.fansub?.id !== fId) {
            const fRes = await openAnimeFetch(baseEpUrl, { fansub: fId });
            epData = fRes?.episodeData || {};
        }

        const fName = f.name || f.secureName || "Varsayılan";
        const files = epData.files || [];
        const fansubSubs = [];

        extractKnownSubs(epData, cdnHost, slug, sNum, fansubSubs);
        extractKnownSubs(f, cdnHost, slug, sNum, fansubSubs);
        for (const fo of files) extractKnownSubs(fo, cdnHost, slug, sNum, fansubSubs);

        // Bilinen alanlarda yoksa derin tara
        if (fansubSubs.length === 0) deepScanSubs(epData, cdnHost, slug, sNum, fansubSubs);

        // Hangi fansub'dan geldiği etikette görünsün
        fansubSubs.forEach(s => { s.label = (s.label ? s.label : mapLang(s.langCode).label) + " [" + fName + "]"; });

        const fansubStreams = [];
        for (const fileObj of files) {
            const relFile = String(fileObj.file || "").replace(/^\/+/, "");
            if (!relFile) continue;

            const fullUrl = `${cdnHost}/animes/${slug}/${sNum}/${relFile}`;
            const resLabel = fileObj.resolution ? `${fileObj.resolution}p` : "Auto";
            const isHls = fullUrl.toLowerCase().includes(".m3u8");

            // HLS içine gömülü altyazılar
            if (isHls) {
                const hlsSubs = await extractHlsSubs(fullUrl);
                hlsSubs.forEach(s => { s.label = (s.label || mapLang(s.langCode).label) + " [" + fName + "]"; });
                fansubSubs.push(...hlsSubs);
            }

            fansubStreams.push({
                name: "OpenAnime",
                title: `[${fName}] ${resLabel}`,
                url: fullUrl,
                quality: resLabel,
                format: isHls ? "hls" : "mp4",
                isHls: isHls,
                provider: "openanime",
                behaviorHints: { notWebReady: false },
                headers: { "Referer": MAIN_URL + "/", "User-Agent": UA }
            });
        }

        // Altyazıları indirip VTT'ye çevir (mobil oynatıcı header/ASS desteklemese de çalışsın)
        const processedSubs = await inlineSubtitles(fansubSubs);
        const formatted = formatSubtitles(processedSubs);
        // Her fansub'ın streamlerine kendi altyazısını ekle
        fansubStreams.forEach(st => { if (formatted.length > 0) st.subtitles = formatted; });
        streams.push(...fansubStreams);
        rawSubs.push(...processedSubs);
    }

    log("toplam altyazı:", rawSubs.length);
    return { streams, subtitles: formatSubtitles(rawSubs) };
}

// --- NUVIO ARAYÜZLERİ ---

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
        const { streams } = await collectEpisode(id, mediaType, season, episode);
        return streams;
    } catch (e) {
        return [];
    }
}

async function getSubtitles(id, mediaType, season, episode) {
    try {
        const { subtitles } = await collectEpisode(id, mediaType, season, episode);
        return { subtitles };
    } catch (e) {
        return { subtitles: [] };
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams, getCatalog, getMeta, getSubtitles };
}
if (typeof globalThis !== "undefined") {
    globalThis.getStreams = getStreams;
    globalThis.getCatalog = getCatalog;
    globalThis.getMeta = getMeta;
    globalThis.getSubtitles = getSubtitles;
}
