(() => {
	const u = new URL(location.href);
	const v = u.searchParams.get("v");
	const list = u.searchParams.get("list");

	const player = document.getElementById("player");
	const message = document.getElementById("message");

	if (!v && !list) {
		player.hidden = true;
		message.hidden = false;
		message.textContent = "Missing ?v=VIDEO_ID or ?list=PLAYLIST_ID";
		return;
	}

	const isPlaylist = Boolean(list) && !v;
	const base = isPlaylist ? "https://www.youtube-nocookie.com/embed/videoseries" : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v || "")}`;

	const params = new URLSearchParams({
		enablejsapi: "1",
		rel: "0",
		controls: "1",
		fs: "1",
		disablekb: "0",
		playsinline: u.searchParams.get("playsinline") || "1",
		autoplay: u.searchParams.get("autoplay") || "0",
		origin: location.origin,
	});

	const start = Number(u.searchParams.get("start") || 0);
	if (Number.isFinite(start) && start > 0) {
		params.set("start", String(Math.floor(start)));
	}

	if (isPlaylist) {
		params.set("list", list);
	}

	const YT_ORIGINS = new Set(["https://www.youtube-nocookie.com", "https://www.youtube.com"]);

	const postToPlayer = (func, args = []) => {
		if (!player.contentWindow) return;
		player.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
	};

	window.addEventListener("message", (event) => {
		if (event.origin === location.origin) {
			const data = event.data;
			if (!data || data.source !== "cleantube-app" || data.type !== "ct-command") return;

			if (data.command === "seekTo") {
				postToPlayer("seekTo", [Number(data.seconds) || 0, true]);
				return;
			}

			if (data.command === "getCurrentTime" || data.command === "getDuration" || data.command === "pauseVideo" || data.command === "playVideo") {
				postToPlayer(data.command, []);
			}
			return;
		}

		if (!YT_ORIGINS.has(event.origin)) return;

		let payload = event.data;
		if (typeof payload === "string") {
			try {
				payload = JSON.parse(payload);
			} catch {
				return;
			}
		}

		if (!payload || payload.event !== "infoDelivery" || typeof payload.info !== "object") return;

		const info = payload.info;
		const currentTime = Number(info.currentTime);
		const duration = Number(info.duration);
		const playerState = Number(info.playerState);

		parent.postMessage(
			{
				source: "cleantube-proxy",
				type: "player-info",
				currentTime: Number.isFinite(currentTime) ? currentTime : undefined,
				duration: Number.isFinite(duration) ? duration : undefined,
				playerState: Number.isFinite(playerState) ? playerState : undefined,
			},
			location.origin,
		);
	});

	player.src = `${base}?${params.toString()}`;
})();
