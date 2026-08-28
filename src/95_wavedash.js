// ---------------------------------------------------------------------------
// Wavedash platform integration - SDK init, player identity, leaderboards.
//
// This file is compiled into the WAVEDASH BUILD ONLY. The competition zip is
// built without it and every call site is behind `if (WD)`, so the 13 KiB
// archive carries none of these bytes. See tools/src.mjs.
//
// Nothing here is allowed to break the game. The platform injects the SDK at
// runtime, so opening dist-wavedash/index.html directly (no sandbox, no SDK)
// must still play perfectly - every entry point checks for the global first
// and every promise has a catch that shrugs.
// ---------------------------------------------------------------------------

const WDS = () => (typeof Wavedash !== 'undefined' ? Wavedash : 0);

let wdUser = null;      // { userId, username, avatarUrl }
let wdAv = null;        // decoded avatar Image, once it loads
let wdLB = 0;           // score leaderboard id
let wdDL = 0;           // depth leaderboard id
let wdTop = [];         // cached top entries: [rank, name, score]
let wdMe = 0;           // my global rank, 0 if unranked
let wdMsg = '';         // one-line status shown under the board
let wdBusy = 0;

// The SDK's async calls all return { success, data, message }; this unwraps
// that shape and turns any failure - rejected, offline, absent - into null,
// which is the only thing the drawing code ever has to handle.
async function wdOk(pr) {
  try {
    const r = await pr;
    return r && r.success ? r.data : null;
  } catch (e) { return null; }
}

// --- boot ------------------------------------------------------------------
function wdInit() {
  const S = WDS();
  if (!S) { wdMsg = 'offline - scores stay local'; return; }
  try {
    S.init({ deferEvents: true });
    S.readyForEvents();
    // Everything is procedural, so there is nothing to stream in: the game is
    // interactive on the first frame.
    if (S.updateLoadProgressZeroToOne) S.updateLoadProgressZeroToOne(1);
    if (S.loadComplete) S.loadComplete();
  } catch (e) { wdMsg = 'sdk init failed'; return; }

  try {
    wdUser = S.getUser && S.getUser();
    if (wdUser && wdUser.avatarUrl) wdAvatar(wdUser.userId);
  } catch (e) { /* identity is optional */ }

  wdBoards();
  wdPresence('In the shaft');
}

// Resolve both leaderboards once at startup and cache their ids, as the docs
// ask. Higher is better for both, and both display as plain numbers.
async function wdBoards() {
  const S = WDS();
  if (!S || !S.getOrCreateLeaderboard) return;
  const D = S.LeaderboardSortOrder ? S.LeaderboardSortOrder.DESC : 1;
  const N = S.LeaderboardDisplayType ? S.LeaderboardDisplayType.NUMERIC : 0;
  const a = await wdOk(S.getOrCreateLeaderboard('prismfall-score', D, N));
  const b = await wdOk(S.getOrCreateLeaderboard('prismfall-depth', D, N));
  if (a) wdLB = a.id;
  if (b) wdDL = b.id;
  wdFetch();
}

// Avatars arrive as a URL; decode once and keep the Image for the title card.
function wdAvatar(id) {
  const S = WDS();
  try {
    const url = S.getUserAvatarUrl ? S.getUserAvatarUrl(id, S.AvatarSize ? S.AvatarSize.MEDIUM : 1)
      : wdUser.avatarUrl;
    if (!url) return;
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { wdAv = im; };
    im.src = url;
  } catch (e) { /* no avatar, no problem */ }
}

// --- leaderboard -----------------------------------------------------------
async function wdFetch() {
  const S = WDS();
  if (!S || !wdLB || wdBusy) return;
  wdBusy = 1;
  const rows = await wdOk(S.listLeaderboardEntries(wdLB, 0, 8, false));
  if (rows) {
    wdTop = rows.map((e) => [e.globalRank, e.username || 'player', e.score]);
    wdMsg = wdTop.length ? '' : 'be the first to post a score';
  }
  const mine = await wdOk(S.getMyLeaderboardEntries(wdLB));
  if (mine && mine.length) wdMe = mine[0].globalRank | 0;
  wdBusy = 0;
}

// Called from endRun. Score and depth go to their own boards, and the run's
// shape rides along as metadata so a board entry can be read back as a story:
// which region ended it, how deep, how many descents, which boons.
function wdSubmit(sc, dp) {
  const S = WDS();
  if (!S || !wdLB || !sc) return;
  const meta = {
    region: REG[reg][0],
    depth: (dp / 10) | 0,
    descents: descent,
    boons: BOONN.filter((n, i) => !(i & 1) && bn(i >> 1)).join(',') || 'none',
  };
  wdOk(S.uploadLeaderboardScore(wdLB, sc, true, undefined, meta)).then((d) => {
    if (d) { wdMe = d.globalRank | 0; wdMsg = 'rank #' + wdMe; }
    wdFetch();
  });
  if (wdDL) wdOk(S.uploadLeaderboardScore(wdDL, dp | 0, true));
  wdPresence('Run over', 'Scored ' + sc);
}

function wdPresence(status, details) {
  const S = WDS();
  try { if (S && S.updateUserPresence) S.updateUserPresence({ status, details: details || '' }); }
  catch (e) { /* presence is cosmetic */ }
}

// --- drawing ---------------------------------------------------------------
// The player's own identity, centred above the title. Avatar if one decoded,
// otherwise the initial in a coloured disc, so the card never has a hole in it.
function wdIdentity(x, y) {
  if (!wdUser) return;
  const r = 17 * U, nm = wdUser.username || 'player';
  if (wdAv) {
    X.save();
    BP(); AR(x - 62 * U, y, r); X.clip();
    X.drawImage(wdAv, x - 62 * U - r, y - r, r * 2, r * 2);
    X.restore();
  } else {
    CIR(x - 62 * U, y, r, chsl(nm.charCodeAt(0) % 7, 46));
    txt(nm[0].toUpperCase(), x - 62 * U, y, 17, W9, 1);
  }
  CIR(x - 62 * U, y, r, 0, UE, 2 * U);
  txt(nm, x - 34 * U, y - 7 * U, 15, W9, 1, 'left');
  txt(wdMe ? 'GLOBAL RANK #' + wdMe : 'UNRANKED', x - 34 * U, y + 10 * U, 11, W3, 0, 'left');
}

// The live top-8, drawn as a side panel. Deliberately unobtrusive: it is
// context for your own score, not the point of the screen.
function wdBoard(x, y) {
  if (!WDS()) return;
  const w = 250 * U;
  RR(x - w / 2, y - 130 * U, w, 260 * U, 12 * U);
  FL('hsl(272 40% 9% / .8)');
  SK(1.4 * U, W3);
  txt('GLOBAL TOP 8', x, y - 108 * U, 13, W9, 1);
  if (!wdTop.length) { txt(wdMsg || 'loading...', x, y, 12, W3); return; }
  wdTop.forEach((e, i) => {
    const ry = y - 78 * U + i * 24 * U;
    const me = wdUser && e[1] === wdUser.username;
    txt('#' + e[0], x - w / 2 + 16 * U, ry, 12, me ? UG : W3, me, 'left');
    txt(e[1].slice(0, 12), x - w / 2 + 54 * U, ry, 12, me ? W9 : W6, me, 'left');
    txt(e[2], x + w / 2 - 16 * U, ry, 12, me ? UG : W6, me, 'right');
  });
}

// --- boot ------------------------------------------------------------------
// Deliberately called from the bottom of THIS file rather than from the game's
// boot block. This file is concatenated last, so at the moment 90_game.js runs
// its boot code every binding above is still in the temporal dead zone and
// wdInit() throws on the first line that touches one.
wdInit();
