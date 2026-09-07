/* =========================================================================
   THE LOSERBOARD — Sleeper fantasy punishment tracker
   Pure client-side. No build, no deps. Computes fines live from Sleeper.
   ========================================================================= */

/*
  League ids are NOT stored in this repo. They come from:
    1. /api/config       → Vercel serverless fn reading the SLEEPER_LEAGUES env var (production)
    2. window.LB_LEAGUES → optional gitignored config.local.js (local dev)
    3. ?league=<id>      → URL override, always available
*/

const FINES = {
  ICE_COLD: 2, // lowest score in the league that week
  BENCH_BASE: 5, // first completed 2-week no-lineup block
  BENCH_MULT: 1.25, // cascade per additional block (resets when lineup is set)
};

const API = "https://api.sleeper.app/v1";
const AVATAR = (id) => `https://sleepercdn.com/avatars/thumbs/${id}`;

// distinct line colors, ordered to pop on the dark turf
const PALETTE = [
  "#ffd000", "#ff5c8a", "#35c46a", "#5aa8ff", "#f07d18",
  "#b06bff", "#2ee6d6", "#ffffff", "#ff7ac2", "#9ae642",
];

const $ = (sel) => document.querySelector(sel);
const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/* ---------- Tabs + boot ---------- */
async function fetchLeagues() {
  // production: env-backed serverless fn (behind auth); ignore if not deployed
  try {
    const cfg = await getJSON("/api/config");
    if (cfg && Array.isArray(cfg.leagues) && cfg.leagues.length) return cfg.leagues;
  } catch (_) {}
  // local dev: optional gitignored config.local.js sets window.LB_LEAGUES
  if (Array.isArray(window.LB_LEAGUES) && window.LB_LEAGUES.length)
    return window.LB_LEAGUES;
  return [];
}

async function init() {
  const params = new URLSearchParams(location.search);
  const override = params.get("league");

  let tabs = await fetchLeagues();
  if (override && !tabs.some((t) => t.id === override)) {
    tabs = [{ label: "CUSTOM", id: override }, ...tabs];
  }
  const activeId = override || (tabs[0] && tabs[0].id);

  if (!activeId) {
    return renderError(
      "No league configured",
      "Set <b>SLEEPER_LEAGUES</b> in your environment, or add <b>?league=&lt;id&gt;</b> to the URL."
    );
  }

  const nav = $("#league-tabs");
  if (tabs.length > 1) {
    nav.hidden = false;
    nav.innerHTML = "";
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (t.id === activeId ? " active" : "");
      btn.textContent = t.label;
      btn.onclick = () => {
        nav
          .querySelectorAll(".tab-btn")
          .forEach((b) => b.classList.toggle("active", b === btn));
        loadLeague(t.id);
      };
      nav.appendChild(btn);
    }
  }

  loadLeague(activeId);
}

function showLoading() {
  $("#toggle").hidden = true;
  $("#board").innerHTML =
    '<div class="loading"><div class="football-spin">🏈</div><p>Reviewing the tape…</p></div>';
}

/* ---------- Load one league ---------- */
async function loadLeague(leagueId) {
  showLoading();

  if (!leagueId || leagueId === "PASTE_HERE") {
    return renderError(
      "No league set",
      "Paste your Sleeper LEAGUE_ID into app.js, or add ?league=&lt;id&gt; to the URL."
    );
  }

  try {
    const state = await getJSON(`${API}/state/nfl`);
    const currentWeek = state.week || state.display_week || 1;

    const [league, rosters, users] = await Promise.all([
      getJSON(`${API}/league/${leagueId}`),
      getJSON(`${API}/league/${leagueId}/rosters`),
      getJSON(`${API}/league/${leagueId}/users`),
    ]);

    // Live current-season league → only weeks before the in-progress one count.
    // Finished past season → scan the full slate (regular + playoffs).
    const isLive = String(league.season) === String(state.season);
    const lastWeek = isLive ? currentWeek - 1 : 18;
    const weekLabel = isLive
      ? "WEEK " + currentWeek
      : "SEASON " + league.season + " · FINAL";

    const requiredStarters = (league.roster_positions || []).filter(
      (p) => p !== "BN"
    ).length;

    // roster_id -> team display info
    const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
    const team = {};
    for (const r of rosters) {
      const u = userById[r.owner_id];
      const handle = (u && u.display_name) || null;
      team[r.roster_id] = {
        name:
          (u && u.metadata && u.metadata.team_name) ||
          handle ||
          `Roster ${r.roster_id}`,
        user: handle,
        avatar: u && u.avatar ? AVATAR(u.avatar) : null,
      };
    }

    const range = [];
    for (let w = 1; w <= lastWeek; w++) range.push(w);

    const fetched = await Promise.all(
      range.map((w) =>
        getJSON(`${API}/league/${leagueId}/matchups/${w}`).then((m) => ({
          week: w,
          teams: m,
        }))
      )
    );

    // Keep only weeks that actually happened (have scores).
    const matchups = fetched.filter(
      (x) => x.teams && x.teams.length && x.teams.some((t) => (t.points || 0) > 0)
    );
    const weeks = matchups.map((x) => x.week);

    const fines = computeFines(matchups, requiredStarters);
    render({ league, team, fines, weekLabel, weeks });
  } catch (err) {
    console.error(err);
    renderError(
      "Couldn't pull the tape",
      "Double-check the league id. Sleeper may also be down. (" +
        err.message +
        ")"
    );
  }
}

// On localhost, try to load the gitignored config.local.js first (for the tabs).
// In production this file isn't requested, so there's no console noise.
async function boot() {
  const local = ["localhost", "127.0.0.1", ""].includes(location.hostname);
  if (local) {
    await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "config.local.js";
      s.onload = s.onerror = resolve;
      document.head.appendChild(s);
    });
  }
  init();
}

boot();

/* ---------- Fine math ---------- */
function computeFines(matchups, requiredStarters) {
  // per roster_id -> { iceCount, iceTotal, benchTotal, byWeek: {w:{ice,bench}} }
  const acc = {};
  const bump = (rid) =>
    (acc[rid] ||= { iceCount: 0, iceTotal: 0, benchTotal: 0, byWeek: {} });
  const week = (rid, w) =>
    (bump(rid).byWeek[w] ||= { ice: 0, bench: 0 });

  const streak = {}; // roster_id -> consecutive missed weeks

  // process chronologically so bench streaks accumulate correctly
  const ordered = [...matchups].sort((a, b) => a.week - b.week);

  for (const { week: w, teams } of ordered) {
    if (!teams || !teams.length) continue;
    const played = teams.some((t) => (t.points || 0) > 0);

    // ---- Ice Cold: lowest score in a played week ----
    if (played) {
      const min = Math.min(...teams.map((t) => t.points || 0));
      for (const t of teams) {
        if ((t.points || 0) === min) {
          const a = bump(t.roster_id);
          a.iceCount += 1;
          a.iceTotal += FINES.ICE_COLD;
          week(t.roster_id, w).ice += FINES.ICE_COLD;
        }
      }
    }

    // ---- Bench Warmer: missed lineup streaks ----
    for (const t of teams) {
      const valid = (t.starters || []).filter((s) => s && s !== "0").length;
      const notSet = valid < requiredStarters;
      if (notSet) {
        streak[t.roster_id] = (streak[t.roster_id] || 0) + 1;
        if (streak[t.roster_id] % 2 === 0) {
          const block = streak[t.roster_id] / 2; // 1st, 2nd block...
          const amt = FINES.BENCH_BASE * Math.pow(FINES.BENCH_MULT, block - 1);
          const a = bump(t.roster_id);
          a.benchTotal += amt;
          const wk = week(t.roster_id, w);
          wk.bench += amt;
          wk.benchBlock = block;
        }
      } else {
        streak[t.roster_id] = 0; // set lineup → reset streak & tier
      }
    }
  }
  return acc;
}

/* ---------- Rendering ---------- */
let VIEW_STATE = null;

function render(data) {
  VIEW_STATE = data;
  $("#subtitle").textContent =
    (data.league.name || "Your League").toUpperCase() + " · " + data.weekLabel;

  if (!data.weeks.length) {
    $("#toggle").hidden = true;
    return renderEmpty(
      "Season hasn't started",
      "Nobody's a loser… yet. Check back after Week 1 wraps. 🏈"
    );
  }

  const toggle = $("#toggle");
  toggle.hidden = false;
  const latest = data.weeks[data.weeks.length - 1];
  toggle.querySelector('[data-view="week"]').textContent = "WEEK " + latest;

  toggle.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.onclick = () => {
      toggle
        .querySelectorAll(".toggle-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      drawBoard(btn.dataset.view);
    };
  });

  drawBoard("season");
}

function drawBoard(view) {
  const { team, fines, weeks } = VIEW_STATE;
  const latest = weeks[weeks.length - 1];

  // Full roster — every league member is listed, even clean $0 ones.
  const rows = Object.keys(team)
    .map((rid) => {
      const f = fines[rid] || {
        iceTotal: 0,
        benchTotal: 0,
        iceCount: 0,
        byWeek: {},
      };
      if (view === "week") {
        const w = (f.byWeek && f.byWeek[latest]) || { ice: 0, bench: 0 };
        return { rid, ice: w.ice, bench: w.bench, iceCount: w.ice ? 1 : 0 };
      }
      return { rid, ice: f.iceTotal, bench: f.benchTotal, iceCount: f.iceCount };
    })
    .map((r) => ({ ...r, total: r.ice + r.bench }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        ((team[a.rid] || {}).name || "").localeCompare((team[b.rid] || {}).name || "")
    );

  // Consistent color per fined team → chart lines, legend, and row dots match.
  const finedRows = rows.filter((r) => r.total > 0);
  const colorByRid = {};
  finedRows.forEach((r, i) => (colorByRid[r.rid] = PALETTE[i % PALETTE.length]));

  const cleanRows = rows.filter((r) => r.total <= 0);

  const board = $("#board");
  board.innerHTML = "";

  if (view === "season" && weeks.length > 1 && finedRows.length) {
    board.appendChild(renderChart(finedRows, colorByRid));
  }

  // builds one expandable card; rankLabel is a number for offenders or "🧼" for the clean
  const makeCard = (r, rankLabel, crown) => {
    const t = team[r.rid] || { name: "Unknown", avatar: null };

    const card = document.createElement("div");
    card.className = "card";

    const row = document.createElement("div");
    row.className = "row " + tierClass(r.total) + (crown ? " loser" : "");

    const badges = [];
    if (r.iceCount)
      badges.push(
        `<span class="badge ice">🥶 ${r.iceCount}× ($${r.ice.toFixed(0)})</span>`
      );
    if (r.bench)
      badges.push(`<span class="badge bench">🪑 ${money(r.bench)}</span>`);
    if (!badges.length)
      badges.push(`<span class="badge clean">✅ clean sheet</span>`);

    const avatar = t.avatar
      ? `<img class="avatar" src="${t.avatar}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar placeholder',textContent:'🏈'}))" />`
      : `<div class="avatar placeholder">🏈</div>`;

    const dot = colorByRid[r.rid]
      ? `<span class="dot" style="background:${colorByRid[r.rid]}"></span>`
      : "";
    const handle =
      t.user && t.user !== t.name
        ? `<div class="handle">@${escapeHtml(t.user)}</div>`
        : "";

    row.innerHTML = `
      <div class="rank">${rankLabel}</div>
      ${avatar}
      <div class="who">
        <div class="team">${dot}${escapeHtml(t.name)}</div>
        ${handle}
        <div class="badges">${badges.join("")}</div>
      </div>
      <div class="owed">${money(r.total)}</div>
      <div class="caret">▸</div>`;

    const detail = document.createElement("div");
    detail.className = "detail";
    detail.hidden = true;
    detail.innerHTML = detailHtml(r.rid, view);

    row.addEventListener("click", () => {
      const open = card.classList.toggle("open");
      detail.hidden = !open;
    });

    card.appendChild(row);
    card.appendChild(detail);
    return card;
  };

  finedRows.forEach((r, i) => board.appendChild(makeCard(r, i + 1, i === 0)));

  // Clean teams live in a collapsed accordion — you're only ON the board if you got fined.
  if (cleanRows.length) {
    const head = document.createElement("button");
    head.className = "section-head";
    head.innerHTML = `
      <span class="section-title">🧼 THE NOT-SO-SHIT LIST <span class="section-count">${cleanRows.length}</span></span>
      <span class="section-sub">${
        finedRows.length
          ? "set their lineups, dodged the fines — tap to peek"
          : "nobody owes a dime — spotless league"
      }</span>
      <span class="section-caret">▸</span>`;

    const group = document.createElement("div");
    group.className = "clean-group";
    // collapsed by default, but auto-open if literally nobody was fined
    const startOpen = finedRows.length === 0;
    group.hidden = !startOpen;
    if (startOpen) head.classList.add("open");
    cleanRows.forEach((r) => group.appendChild(makeCard(r, "🧼", false)));

    head.addEventListener("click", () => {
      const open = head.classList.toggle("open");
      group.hidden = !open;
    });

    board.appendChild(head);
    board.appendChild(group);
  }
}

const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
function ordinal(n) {
  return ORD[n] || n + "th";
}

// Per-week breakdown shown when a player row is expanded.
function detailHtml(rid, view) {
  const f = VIEW_STATE.fines[rid] || { byWeek: {} };
  const weeks =
    view === "week"
      ? [VIEW_STATE.weeks[VIEW_STATE.weeks.length - 1]]
      : VIEW_STATE.weeks;

  const items = [];
  let iceSum = 0,
    benchSum = 0;
  for (const w of weeks) {
    const bw = f.byWeek && f.byWeek[w];
    if (!bw) continue;
    if (bw.ice > 0) {
      iceSum += bw.ice;
      items.push({
        w,
        type: "ice",
        icon: "🥶",
        label: "Lowest score in the league",
        amt: bw.ice,
      });
    }
    if (bw.bench > 0) {
      benchSum += bw.bench;
      items.push({
        w,
        type: "bench",
        icon: "🪑",
        label: `No lineup · ${ordinal(bw.benchBlock)} straight 2-week block`,
        amt: bw.bench,
      });
    }
  }

  if (!items.length)
    return `<div class="detail-clean">✅ No fines — a model citizen. 🫡</div>`;

  const stat = (cls, ico, txt, val) =>
    `<div class="stat ${cls}"><span class="stat-ico">${ico}</span><div class="stat-meta"><span class="stat-txt">${txt}</span><span class="stat-amt">${money(
      val
    )}</span></div></div>`;

  const summary =
    `<div class="detail-summary">` +
    stat("ice", "🥶", "Ice Cold", iceSum) +
    stat("bench", "🪑", "Bench Warmer", benchSum) +
    `</div>`;

  const list = items
    .map(
      (it) =>
        `<div class="fine-item ${it.type}">
          <span class="fine-wk">WK ${it.w}</span>
          <span class="fine-icon">${it.icon}</span>
          <span class="fine-label">${it.label}</span>
          <span class="fine-amt">${money(it.amt)}</span>
        </div>`
    )
    .join("");

  return summary + `<div class="fine-list">${list}</div>`;
}

// Cumulative-fines line chart (hand-rolled SVG, no libraries).
function renderChart(rows, colorByRid) {
  const weeks = VIEW_STATE.weeks;
  const team = VIEW_STATE.team;
  const fines = VIEW_STATE.fines;

  const series = rows.map((r) => {
    let cum = 0;
    const pts = weeks.map((w) => {
      const bw = (fines[r.rid].byWeek && fines[r.rid].byWeek[w]) || {};
      cum += (bw.ice || 0) + (bw.bench || 0);
      return cum;
    });
    return {
      rid: r.rid,
      name: (team[r.rid] || {}).name || "R" + r.rid,
      color: colorByRid[r.rid],
      pts,
    };
  });

  const W = 680, H = 300, padL = 46, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = weeks.length;
  const rawMax = Math.max(...series.map((s) => s.pts[s.pts.length - 1]), 1);
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const maxY = Math.ceil(rawMax / step) * step || rawMax;
  const xFor = (i) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yFor = (v) => padT + plotH * (1 - v / maxY);

  // gridlines + $ labels
  let grid = "";
  for (let k = 0; k <= 4; k++) {
    const v = (maxY * k) / 4;
    const y = yFor(v);
    grid += `<line class="grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
    grid += `<text class="axis" x="${padL - 6}" y="${y + 4}" text-anchor="end">$${
      Math.round(v)
    }</text>`;
  }
  // week labels (thin out if crowded)
  const everyX = Math.ceil(n / 9);
  let xlabels = "";
  weeks.forEach((w, i) => {
    if (i % everyX === 0 || i === n - 1)
      xlabels += `<text class="axis" x="${xFor(i)}" y="${H - 10}" text-anchor="middle">${w}</text>`;
  });

  const lines = series
    .map((s) => {
      const poly = s.pts.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
      const dots = s.pts
        .map((v, i) => `<circle cx="${xFor(i)}" cy="${yFor(v)}" r="2.4" fill="${s.color}"/>`)
        .join("");
      return `<g class="series" data-rid="${s.rid}"><polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="2.5"/>${dots}</g>`;
    })
    .join("");

  const legend = series
    .map(
      (s) =>
        `<span class="leg" data-rid="${s.rid}"><span class="swatch" style="background:${s.color}"></span>${escapeHtml(
          s.name
        )}</span>`
    )
    .join("");

  const panel = document.createElement("div");
  panel.className = "chart-panel";
  panel.innerHTML = `
    <h3 class="chart-title">📈 SEASON DAMAGE OVER TIME</h3>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cumulative fines by week">
      ${grid}${xlabels}${lines}
    </svg>
    <div class="chart-legend">${legend}</div>`;

  // hover a legend item OR a line to spotlight that player
  const focus = (rid) => {
    panel.classList.toggle("focusing", rid != null);
    panel
      .querySelectorAll("[data-rid]")
      .forEach((el) => el.classList.toggle("hot", el.dataset.rid === rid));
  };
  panel.querySelectorAll("[data-rid]").forEach((el) => {
    el.addEventListener("mouseenter", () => focus(el.dataset.rid));
    el.addEventListener("mouseleave", () => focus(null));
  });

  return panel;
}

function tierClass(total) {
  if (total <= 0) return "tier-clean";
  if (total < 5) return "tier-1";
  if (total < 15) return "tier-2";
  return "tier-3";
}

/* ---------- State helpers ---------- */
function emptyEl(title, msg) {
  const el = document.createElement("div");
  el.className = "empty";
  el.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${msg}</p>`;
  return el;
}
function renderEmpty(title, msg) {
  $("#board").innerHTML = "";
  $("#board").appendChild(emptyEl(title, msg));
}
function renderError(title, msg) {
  $("#toggle").hidden = true;
  $("#subtitle").textContent = "SETUP NEEDED";
  $("#board").innerHTML = `<div class="error"><h2>${title}</h2><p>${msg}</p></div>`;
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
