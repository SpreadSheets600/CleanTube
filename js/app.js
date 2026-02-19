import { parseYouTubeInput, noteKeyFor, makeProxySrc, thumbnailFor, toFiniteNumber, formatTime, dayKey, loadStoredState, saveStoredState } from "./shared.js";

const PLAYER_POLL_MS = 1000;
const PROGRESS_SAVE_MS = 5000;
const SIDEBAR_PREF_KEY = "cleantube.sidebar.hidden";
const NOTES_PREF_KEY = "cleantube.notes.hidden";

const dom = {
	urlInput: document.getElementById("url-input"),
	loadBtn: document.getElementById("load-btn"),
	savedVideos: document.getElementById("saved-videos"),
	savedPlaylists: document.getElementById("playlist-list"),
	addVideoBtn: document.getElementById("add-video-btn"),
	addPlaylistBtn: document.getElementById("add-playlist-btn"),
	clearVideosBtn: document.getElementById("clear-videos-btn"),
	clearPlaylistsBtn: document.getElementById("clear-playlists-btn"),
	toggleSidebarBtn: document.getElementById("toggle-sidebar-btn"),
	fullscreenBtn: document.getElementById("fullscreen-btn"),
	appLayout: document.getElementById("app-layout"),
	sidebarPanel: document.getElementById("sidebar-panel"),
	videoPlayer: document.getElementById("video-player"),
	playerEmptyState: document.getElementById("player-empty-state"),
	notesTextarea: document.getElementById("notes-textarea"),
	notesContent: document.getElementById("notes-content"),
	notesCard: document.getElementById("notes-card"),
	toggleNotesBtn: document.getElementById("toggle-notes-btn"),
	mainPanel: document.getElementById("main-panel"),
	notifications: document.getElementById("notification-container"),
};

function showNotification(message, type = "info", duration = 2800) {
	const cls =
		type === "error" ? "alert-error"
		: type === "warning" ? "alert-warning"
		: type === "success" ? "alert-success"
		: "alert-info";

	const node = document.createElement("div");
	node.className = `alert ${cls} shadow-lg`;
	node.innerHTML = `<span>${message}</span>`;
	dom.notifications.appendChild(node);

	const remove = () => node.remove();
	const timer = setTimeout(remove, duration);
	node.addEventListener("click", () => {
		clearTimeout(timer);
		remove();
	});
}

class CleanTubeApp {
	constructor() {
		this.state = loadStoredState();
		this.playerPollInterval = null;
		this.lastProgressSaveAt = 0;
		this.lastPlayerSample = { currentTime: 0, playerState: -1 };
		this.playerSnapshot = { currentTime: 0, duration: 0, playerState: -1 };

		this.bindEvents();
		this.bindProxyBridge();
		this.restoreSidebarPreference();
		this.restoreNotesPreference();
		this.renderAll();

		if (this.state.current) {
			const match = this.findItem(this.state.current.type, this.state.current.id);
			if (match) this.playItem(match, false);
		}

		this.startPlayerPolling();
	}

	persist() {
		try {
			saveStoredState(this.state);
		} catch {
			showNotification("Storage is full. Remove some saved items.", "warning");
		}
	}

	persistThrottled() {
		const now = Date.now();
		if (now - this.lastProgressSaveAt >= PROGRESS_SAVE_MS) {
			this.lastProgressSaveAt = now;
			this.persist();
		}
	}

	bindEvents() {
		dom.loadBtn.addEventListener("click", () => this.loadFromInput());
		dom.urlInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") this.loadFromInput();
		});

		dom.addVideoBtn.addEventListener("click", () => this.addByPrompt("video"));
		dom.addPlaylistBtn.addEventListener("click", () => this.addByPrompt("playlist"));

		dom.clearVideosBtn.addEventListener("click", () => this.clearItems("video"));
		dom.clearPlaylistsBtn.addEventListener("click", () => this.clearItems("playlist"));

		dom.toggleSidebarBtn?.addEventListener("click", () => this.toggleSidebar());
		dom.toggleNotesBtn?.addEventListener("click", () => this.toggleNotes());
		dom.fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());

		dom.savedVideos.addEventListener("click", (event) => this.handleItemAction(event, "video"));
		dom.savedPlaylists.addEventListener("click", (event) => this.handleItemAction(event, "playlist"));

		dom.notesTextarea.addEventListener("input", () => this.saveNoteText());
	}

	bindProxyBridge() {
		window.addEventListener("message", (event) => {
			if (event.origin !== location.origin) return;
			const data = event.data;
			if (!data || data.source !== "cleantube-proxy") return;
			if (data.type === "player-info") this.handlePlayerInfo(data);
		});
	}

	startPlayerPolling() {
		if (this.playerPollInterval) clearInterval(this.playerPollInterval);
		this.playerPollInterval = setInterval(() => {
			if (!this.state.current) return;
			this.sendProxyCommand("getCurrentTime");
			this.sendProxyCommand("getDuration");
		}, PLAYER_POLL_MS);
	}

	sendProxyCommand(command, payload = {}) {
		const frame = dom.videoPlayer.contentWindow;
		if (!frame) return;
		frame.postMessage(
			{
				source: "cleantube-app",
				type: "ct-command",
				command,
				...payload,
			},
			location.origin,
		);
	}

	loadFromInput() {
		const raw = dom.urlInput.value.trim();
		if (!raw) {
			showNotification("Paste a YouTube URL or video ID.", "warning");
			return;
		}

		const parsed = parseYouTubeInput(raw);
		if (!parsed) {
			showNotification("Invalid YouTube URL or ID.", "error");
			return;
		}

		const item = this.buildItem(parsed);
		const result = this.addItem(item);
		if (result?.item) this.playItem(result.item, true);

		dom.urlInput.value = "";
	}

	buildItem(parsed) {
		return {
			type: parsed.type,
			id: parsed.id,
			url: parsed.canonicalUrl,
			title: parsed.type === "video" ? `Video ${parsed.id}` : `Playlist ${parsed.id}`,
		};
	}

	itemsFor(type) {
		return type === "video" ? this.state.videos : this.state.playlists;
	}

	findItem(type, id) {
		return this.itemsFor(type).find((entry) => entry.id === id) || null;
	}

	addItem(item, customTitle) {
		const list = this.itemsFor(item.type);
		const exists = list.find((entry) => entry.id === item.id);
		if (exists) {
			showNotification("Already saved. Playing existing item.", "info");
			return { item: exists };
		}

		const next = {
			...item,
			title: (customTitle && customTitle.trim()) || item.title,
		};

		list.push(next);
		this.renderList(item.type);
		this.persist();
		showNotification(`${item.type === "video" ? "Video" : "Playlist"} saved.`, "success");
		return { item: next };
	}

	addByPrompt(expectedType) {
		const label = expectedType === "video" ? "video" : "playlist";
		const value = window.prompt(`Enter YouTube ${label} URL or ID:`);
		if (!value) return;

		const parsed = parseYouTubeInput(value);
		if (!parsed || parsed.type !== expectedType) {
			showNotification(`That is not a valid ${label} URL.`, "error");
			return;
		}

		const title = window.prompt("Custom title (optional):") || "";
		const result = this.addItem(this.buildItem(parsed), title);
		if (result?.item) this.playItem(result.item, true);
	}

	playItem(item, autoplay = true) {
		const key = noteKeyFor(item);
		const tracked = this.state.progress[key] || {};
		const duration = toFiniteNumber(tracked.duration, 0);
		const lastTime = toFiniteNumber(tracked.lastTime, 0);
		const resumeAt = lastTime > 5 && (duration <= 0 || lastTime < duration - 5) ? lastTime : 0;

		dom.videoPlayer.src = makeProxySrc(item, autoplay ? "1" : "0", resumeAt);
		dom.playerEmptyState.hidden = true;

		this.state.current = { type: item.type, id: item.id };
		this.lastPlayerSample = { currentTime: resumeAt, playerState: -1 };
		this.playerSnapshot = { currentTime: resumeAt, duration, playerState: -1 };

		this.loadNoteText(item);
		dom.notesTextarea.disabled = false;
		this.persist();

		if (resumeAt > 0) showNotification(`Resumed from ${formatTime(resumeAt)}.`, "info");
	}

	clearCurrentContext() {
		this.state.current = null;
		dom.videoPlayer.src = "";
		dom.playerEmptyState.hidden = false;
		dom.notesTextarea.value = "";
		dom.notesTextarea.disabled = true;
	}

	currentItem() {
		if (!this.state.current) return null;
		return this.findItem(this.state.current.type, this.state.current.id);
	}

	saveNoteText() {
		const item = this.currentItem();
		if (!item) return;
		const key = noteKeyFor(item);
		this.state.notes[key] = dom.notesTextarea.value;
		this.persistThrottled();
	}

	loadNoteText(item) {
		const key = noteKeyFor(item);
		dom.notesTextarea.value = this.state.notes[key] || "";
	}

	updateAnalytics(type, secondsDelta) {
		const date = dayKey();
		const daily = this.state.analytics.dailyWatchSeconds;
		const byType = this.state.analytics.dailyWatchByType;

		daily[date] = toFiniteNumber(daily[date], 0) + secondsDelta;
		if (!byType[date] || typeof byType[date] !== "object") {
			byType[date] = { video: 0, playlist: 0 };
		}
		byType[date][type] = toFiniteNumber(byType[date][type], 0) + secondsDelta;
	}

	updateProgress(item, currentTime, duration, playerState) {
		const key = noteKeyFor(item);
		const prevTime = toFiniteNumber(this.lastPlayerSample.currentTime, 0);
		const prevState = toFiniteNumber(this.lastPlayerSample.playerState, -1);

		const tracked = this.state.progress[key] || { lastTime: 0, duration: 0, watchedSeconds: 0, percent: 0 };
		const nextTime = Math.max(0, toFiniteNumber(currentTime, tracked.lastTime));
		const nextDuration = Math.max(0, toFiniteNumber(duration, tracked.duration));

		const delta = nextTime - prevTime;
		if (prevState === 1 && playerState === 1 && delta > 0 && delta < 10) {
			tracked.watchedSeconds += delta;
			this.updateAnalytics(item.type, delta);
		}

		tracked.lastTime = nextTime;
		tracked.duration = nextDuration;
		tracked.percent = nextDuration > 0 ? Math.min(100, Math.round((nextTime / nextDuration) * 100)) : tracked.percent;

		this.state.progress[key] = tracked;
		this.lastPlayerSample = { currentTime: nextTime, playerState };
		this.playerSnapshot = { currentTime: nextTime, duration: nextDuration, playerState };

		this.persistThrottled();
		this.renderList(item.type);
	}

	handlePlayerInfo(data) {
		const item = this.currentItem();
		if (!item) return;

		const currentTime = toFiniteNumber(data.currentTime, this.playerSnapshot.currentTime);
		const duration = toFiniteNumber(data.duration, this.playerSnapshot.duration);
		const playerState = toFiniteNumber(data.playerState, this.playerSnapshot.playerState);

		this.updateProgress(item, currentTime, duration, playerState);
	}

	clearItems(type) {
		const list = this.itemsFor(type);
		if (!list.length) return;

		const label = type === "video" ? "videos" : "playlists";
		if (!window.confirm(`Clear all saved ${label}?`)) return;

		list.forEach((item) => {
			const key = noteKeyFor(item);
			delete this.state.notes[key];
			delete this.state.progress[key];
		});

		if (type === "video") this.state.videos = [];
		else this.state.playlists = [];

		if (this.state.current?.type === type) this.clearCurrentContext();

		this.renderList(type);
		this.persist();
		showNotification(`Cleared all ${label}.`, "success");
	}

	handleItemAction(event, type) {
		const actionBtn = event.target.closest("button[data-action]");
		if (!actionBtn) return;

		const node = actionBtn.closest("li[data-id]");
		if (!node) return;

		const list = this.itemsFor(type);
		const index = list.findIndex((entry) => entry.id === node.dataset.id);
		if (index < 0) return;

		if (actionBtn.dataset.action === "play") {
			this.playItem(list[index], true);
			return;
		}

		if (actionBtn.dataset.action === "rename") {
			const next = window.prompt("New title:", list[index].title);
			if (!next) return;
			list[index].title = next.trim();
			this.renderList(type);
			this.persist();
			return;
		}

		if (actionBtn.dataset.action === "delete") {
			const item = list[index];
			if (!window.confirm(`Delete ${item.title}?`)) return;

			list.splice(index, 1);
			const key = noteKeyFor(item);
			delete this.state.notes[key];
			delete this.state.progress[key];

			if (this.state.current?.type === type && this.state.current.id === item.id) {
				this.clearCurrentContext();
			}

			this.renderList(type);
			this.persist();
			return;
		}

		if (actionBtn.dataset.action === "up" && index > 0) {
			[list[index - 1], list[index]] = [list[index], list[index - 1]];
			this.renderList(type);
			this.persist();
			return;
		}

		if (actionBtn.dataset.action === "down" && index < list.length - 1) {
			[list[index + 1], list[index]] = [list[index], list[index + 1]];
			this.renderList(type);
			this.persist();
		}
	}

	renderAll() {
		this.renderList("video");
		this.renderList("playlist");

		if (!this.state.current) {
			this.clearCurrentContext();
		}
	}

	renderList(type) {
		const target = type === "video" ? dom.savedVideos : dom.savedPlaylists;
		const list = this.itemsFor(type);
		target.textContent = "";

		if (!list.length) {
			const li = document.createElement("li");
			li.className = "text-xs opacity-50 p-3 text-center";
			li.textContent = type === "video" ? "No saved videos yet." : "No saved playlists yet.";
			target.appendChild(li);
			return;
		}

		const fragment = document.createDocumentFragment();

		list.forEach((item) => {
			const li = document.createElement("li");
			li.className = "rounded-lg bg-base-200 border border-base-300 overflow-hidden hover:border-primary/30 transition-colors";
			li.dataset.id = item.id;

			const row = document.createElement("div");
			row.className = "flex items-center gap-2.5 p-2.5";

			const thumb = thumbnailFor(item);
			if (thumb) {
				const img = document.createElement("img");
				img.src = thumb;
				img.alt = "Thumbnail";
				img.loading = "lazy";
				img.className = "w-16 h-11 object-cover rounded-md border border-base-300";
				row.appendChild(img);
			}

			const content = document.createElement("div");
			content.className = "flex-1 min-w-0";

			const title = document.createElement("p");
			title.className = "text-sm truncate";
			title.textContent = item.title;
			content.appendChild(title);

			const prog = this.state.progress[noteKeyFor(item)];
			if (prog) {
				const meta = document.createElement("p");
				meta.className = "text-xs opacity-50";
				meta.textContent = `${Math.max(0, Math.round(toFiniteNumber(prog.percent, 0)))}% watched`;
				content.appendChild(meta);
			}

			row.appendChild(content);
			li.appendChild(row);

			const actions = document.createElement("div");
			actions.className = "flex items-center justify-center gap-1 border-t border-base-300 bg-base-300/30 px-2 py-1";

			[
				["play", "ph-bold ph-play", "Play"],
				["rename", "ph ph-pencil-simple", "Rename"],
				["delete", "ph ph-trash", "Delete"],
				["up", "ph ph-arrow-up", "Move up"],
				["down", "ph ph-arrow-down", "Move down"],
			].forEach(([action, icon, label]) => {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.dataset.action = action;
				btn.className = "btn btn-xs btn-ghost btn-square tooltip tooltip-bottom";
				btn.dataset.tip = label;
				btn.title = label;
				btn.innerHTML = `<i class="${icon}"></i>`;
				actions.appendChild(btn);
			});

			li.appendChild(actions);
			fragment.appendChild(li);
		});

		target.appendChild(fragment);
	}

	async toggleFullscreen() {
		const shell = document.getElementById("video-shell");
		try {
			if (!document.fullscreenElement) await shell.requestFullscreen();
			else await document.exitFullscreen();
		} catch {
			showNotification("Fullscreen unavailable in this browser context.", "error");
		}
	}

	toggleSidebar() {
		if (!dom.sidebarPanel || !dom.toggleSidebarBtn) return;

		const hidden = dom.sidebarPanel.classList.toggle("hidden");
		dom.appLayout.style.gridTemplateColumns = hidden ? "1fr" : "";
		dom.toggleSidebarBtn.title = hidden ? "Show Sidebar" : "Hide Sidebar";
		dom.toggleSidebarBtn.setAttribute("aria-label", dom.toggleSidebarBtn.title);

		try {
			localStorage.setItem(SIDEBAR_PREF_KEY, hidden ? "1" : "0");
		} catch {}
	}

	restoreSidebarPreference() {
		if (!dom.sidebarPanel || !dom.toggleSidebarBtn || !dom.appLayout) return;

		let hidden = false;
		try {
			hidden = localStorage.getItem(SIDEBAR_PREF_KEY) === "1";
		} catch {}
		if (!hidden) return;

		dom.sidebarPanel.classList.add("hidden");
		dom.appLayout.style.gridTemplateColumns = "1fr";
		dom.toggleSidebarBtn.title = "Show Sidebar";
		dom.toggleSidebarBtn.setAttribute("aria-label", "Show Sidebar");
	}

	toggleNotes() {
		if (!dom.notesContent || !dom.toggleNotesBtn) return;

		const hidden = dom.notesContent.classList.toggle("hidden");
		const icon = dom.toggleNotesBtn.querySelector("i");
		if (icon) icon.className = hidden ? "ph ph-caret-down" : "ph ph-caret-up";
		dom.toggleNotesBtn.title = hidden ? "Show Notes" : "Hide Notes";
		dom.toggleNotesBtn.dataset.tip = dom.toggleNotesBtn.title;

		if (hidden) {
			dom.notesCard.classList.remove("min-h-0");
			dom.notesCard.classList.add("h-fit");
			dom.mainPanel.style.gridTemplateRows = "1fr auto";
		} else {
			dom.notesCard.classList.add("min-h-0");
			dom.notesCard.classList.remove("h-fit");
			dom.mainPanel.style.gridTemplateRows = "";
		}

		try {
			localStorage.setItem(NOTES_PREF_KEY, hidden ? "1" : "0");
		} catch {}
	}

	restoreNotesPreference() {
		if (!dom.notesContent || !dom.toggleNotesBtn) return;

		let hidden = false;
		try {
			hidden = localStorage.getItem(NOTES_PREF_KEY) === "1";
		} catch {}
		if (!hidden) return;

		dom.notesContent.classList.add("hidden");
		const icon = dom.toggleNotesBtn.querySelector("i");
		if (icon) icon.className = "ph ph-caret-down";
		dom.toggleNotesBtn.title = "Show Notes";
		dom.toggleNotesBtn.dataset.tip = "Show Notes";
		dom.notesCard.classList.remove("min-h-0");
		dom.notesCard.classList.add("h-fit");
		dom.mainPanel.style.gridTemplateRows = "1fr auto";
	}
}

document.addEventListener("DOMContentLoaded", () => {
	new CleanTubeApp();
});
