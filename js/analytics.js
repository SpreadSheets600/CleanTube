import { dayKey, formatTime, loadStoredState, toFiniteNumber } from "./shared.js";

const dom = {
	total: document.getElementById("total-watch"),
	video: document.getElementById("video-watch"),
	playlist: document.getElementById("playlist-watch"),
	notes: document.getElementById("notes-count"),
	table: document.getElementById("daily-table"),
	trendCanvas: document.getElementById("watch-trend-chart"),
	splitCanvas: document.getElementById("watch-split-chart"),
};

let trendChart = null;
let splitChart = null;

function countTimelineNotes(state) {
	return Object.values(state.timelineNotes).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

function buildRows(state) {
	const rows = [];
	for (let i = 0; i < 7; i += 1) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const key = dayKey(d);
		const byType = state.analytics.dailyWatchByType[key] || {};

		rows.push({
			dateLabel: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
			fullDate: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
			total: toFiniteNumber(state.analytics.dailyWatchSeconds[key], 0),
			videos: toFiniteNumber(byType.video, 0),
			playlists: toFiniteNumber(byType.playlist, 0),
		});
	}
	return rows;
}

function renderCharts(rows, weekVideo, weekPlaylist) {
	if (typeof Chart !== "function") return;

	const trendRows = [...rows].reverse();
	const labels = trendRows.map((row) => row.dateLabel);
	const totalData = trendRows.map((row) => Math.round(row.total / 60));

	if (trendChart) trendChart.destroy();
	trendChart = new Chart(dom.trendCanvas, {
		type: "line",
		data: {
			labels,
			datasets: [
				{
					label: "Minutes watched",
					data: totalData,
					borderColor: "#22d3ee",
					backgroundColor: "rgba(34, 211, 238, 0.18)",
					tension: 0.3,
					fill: true,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				y: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.2)" } },
				x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.12)" } },
			},
		},
	});

	if (splitChart) splitChart.destroy();
	splitChart = new Chart(dom.splitCanvas, {
		type: "doughnut",
		data: {
			labels: ["Videos", "Playlists"],
			datasets: [
				{
					data: [weekVideo, weekPlaylist],
					backgroundColor: ["#38bdf8", "#34d399"],
					borderColor: ["#0f172a", "#0f172a"],
					borderWidth: 2,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					position: "bottom",
					labels: { color: "#cbd5e1" },
				},
			},
		},
	});
}

function render() {
	const state = loadStoredState();
	const rows = buildRows(state);

	let weekTotal = 0;
	let weekVideo = 0;
	let weekPlaylist = 0;

	rows.forEach((row) => {
		weekTotal += row.total;
		weekVideo += row.videos;
		weekPlaylist += row.playlists;
	});

	dom.total.textContent = formatTime(weekTotal);
	dom.video.textContent = formatTime(weekVideo);
	dom.playlist.textContent = formatTime(weekPlaylist);
	dom.notes.textContent = String(countTimelineNotes(state));

	dom.table.textContent = "";
	const fragment = document.createDocumentFragment();
	rows.forEach((row) => {
		const tr = document.createElement("tr");
		tr.innerHTML = `
      <td>${row.fullDate}</td>
      <td>${formatTime(row.total)}</td>
      <td>${formatTime(row.videos)}</td>
      <td>${formatTime(row.playlists)}</td>
    `;
		fragment.appendChild(tr);
	});
	dom.table.appendChild(fragment);

	renderCharts(rows, weekVideo, weekPlaylist);
}

render();
