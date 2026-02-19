export const STORAGE_KEY = "cleantube.v2";

export function toFiniteNumber(value, fallback = 0) {
	const num = Number(value);
	return Number.isFinite(num) ? num : fallback;
}

export function isYouTubeId(value) {
	return /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function parseYouTubeInput(input) {
	const raw = String(input || "").trim();
	if (!raw) return null;

	if (isYouTubeId(raw)) {
		return { type: "video", id: raw, canonicalUrl: `https://www.youtube.com/watch?v=${raw}` };
	}

	let url;
	try {
		url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
	} catch {
		return null;
	}

	const host = url.hostname.replace(/^www\./, "").toLowerCase();
	const path = url.pathname;
	const v = url.searchParams.get("v");
	const list = url.searchParams.get("list");

	if (host === "youtu.be") {
		const shortId = path.slice(1).split("/")[0];
		if (isYouTubeId(shortId)) {
			return { type: "video", id: shortId, canonicalUrl: `https://www.youtube.com/watch?v=${shortId}` };
		}
	}

	const isYouTubeHost = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");

	if (!isYouTubeHost) return null;

	if (v && isYouTubeId(v)) {
		return { type: "video", id: v, canonicalUrl: `https://www.youtube.com/watch?v=${v}` };
	}

	if (path.startsWith("/shorts/") || path.startsWith("/live/")) {
		const id = path.split("/")[2];
		if (isYouTubeId(id)) {
			return { type: "video", id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` };
		}
	}

	if (path.startsWith("/embed/")) {
		const id = path.split("/")[2];
		if (id === "videoseries" && list) {
			return {
				type: "playlist",
				id: list,
				canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`,
			};
		}

		if (isYouTubeId(id)) {
			return { type: "video", id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` };
		}
	}

	if (list) {
		return {
			type: "playlist",
			id: list,
			canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`,
		};
	}

	return null;
}

export function noteKeyFor(item) {
	return `${item.type}:${item.id}`;
}

export function dayKey(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

export function formatTime(totalSeconds) {
	const s = Math.max(0, Math.floor(toFiniteNumber(totalSeconds, 0)));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) {
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
	}
	return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function defaultState() {
	return {
		videos: [],
		playlists: [],
		notes: {},
		timelineNotes: {},
		progress: {},
		analytics: {
			dailyWatchSeconds: {},
			dailyWatchByType: {},
		},
		current: null,
	};
}

export function loadStoredState() {
	const base = defaultState();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return base;
		const parsed = JSON.parse(raw);
		return {
			...base,
			videos: Array.isArray(parsed.videos) ? parsed.videos : [],
			playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
			notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
			timelineNotes: parsed.timelineNotes && typeof parsed.timelineNotes === "object" ? parsed.timelineNotes : {},
			progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {},
			analytics:
				parsed.analytics && typeof parsed.analytics === "object" ?
					{
						dailyWatchSeconds: parsed.analytics.dailyWatchSeconds && typeof parsed.analytics.dailyWatchSeconds === "object" ? parsed.analytics.dailyWatchSeconds : {},
						dailyWatchByType: parsed.analytics.dailyWatchByType && typeof parsed.analytics.dailyWatchByType === "object" ? parsed.analytics.dailyWatchByType : {},
					}
				:	base.analytics,
			current: parsed.current && typeof parsed.current === "object" ? parsed.current : null,
		};
	} catch {
		return base;
	}
}

export function saveStoredState(state) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function makeProxySrc(item, autoplay = "1", startAt = 0) {
	const params = new URLSearchParams({
		autoplay: autoplay === "1" ? "1" : "0",
		playsinline: "1",
	});

	if (item.type === "video") params.set("v", item.id);
	else params.set("list", item.id);

	if (startAt > 0) params.set("start", String(Math.floor(startAt)));

	return `proxy.html?${params.toString()}`;
}

export function thumbnailFor(item) {
	if (item.type !== "video") return null;
	return `https://i.ytimg.com/vi/${encodeURIComponent(item.id)}/mqdefault.jpg`;
}
