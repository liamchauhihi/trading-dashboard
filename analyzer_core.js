/* Stock analyzer engine: indicators, support/resistance, chart patterns, strategy backtests,
   stop-loss / take-profit levels. Pure functions, no DOM: used by analyzer.html and testable with node.
   Bars are oldest-first: {t: "YYYY-MM-DD[ HH:MM:SS]", o, h, l, c, v}. */
(function (root) {
"use strict";

const COST = 0.0005;          // per side (commission-free broker, spread/slippage only)
const PIVOT_K = 5;            // a pivot high/low is the extreme of the 5 bars either side
const FWD = 20;               // days after a pattern signal used to judge whether it worked
const BT_YEARS = 10;

// ---------- indicators ----------
function sma(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

function ema(a, n) {
  const out = new Array(a.length).fill(NaN);
  const k = 2 / (n + 1);
  let e = NaN;
  for (let i = 0; i < a.length; i++) {
    if (isNaN(a[i])) continue;
    e = isNaN(e) ? a[i] : a[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function stdev(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0, s2 = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]; s2 += a[i] * a[i];
    if (i >= n) { s -= a[i - n]; s2 -= a[i - n] * a[i - n]; }
    if (i >= n - 1) out[i] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  }
  return out;
}

function rsi(c, n) {                                   // Wilder smoothing, same as the bot
  const out = new Array(c.length).fill(NaN);
  let g = 0, l = 0;
  const val = () => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i === n) { g /= n; l /= n; out[i] = val(); }
    } else {
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = val();
    }
  }
  return out;
}

function atr(b, n) {
  const out = new Array(b.length).fill(NaN);
  let a = NaN, s = 0;
  for (let i = 1; i < b.length; i++) {
    const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    if (i <= n) { s += tr; if (i === n) { a = s / n; out[i] = a; } }
    else { a = (a * (n - 1) + tr) / n; out[i] = a; }
  }
  return out;
}

function indicators(b) {
  const c = b.map(x => x.c);
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const macd = c.map((_, i) => e12[i] - e26[i]);
  const signal = ema(macd, 9);
  const mid = sma(c, 20), sd = stdev(c, 20);
  return {
    c, ma5: sma(c, 5), ma20: mid, ma50: sma(c, 50), ma200: sma(c, 200),
    rsi14: rsi(c, 14), rsi2: rsi(c, 2), atr: atr(b, 14),
    macd, signal, hist: macd.map((m, i) => m - signal[i]),
    bbUp: mid.map((m, i) => m + 2 * sd[i]), bbLo: mid.map((m, i) => m - 2 * sd[i]),
  };
}

// ---------- pivots and support / resistance ----------
function pivots(b, k = PIVOT_K) {
  const hi = [], lo = [];
  for (let i = k; i < b.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k && (isH || isL); j++) {
      if (j === i) continue;
      if (j < i ? b[j].h >= b[i].h : b[j].h > b[i].h) isH = false;   // ties: the first one counts
      if (j < i ? b[j].l <= b[i].l : b[j].l < b[i].l) isL = false;
    }
    if (isH) hi.push(i);
    if (isL) lo.push(i);
  }
  return { hi, lo };
}

// pivots known on bar `end` (a pivot is only confirmed k bars after it), inside [from, end - k]
function pivotsIn(list, from, end, k = PIVOT_K) {
  const out = [];
  for (let x = lowerBound(list, from); x < list.length && list[x] <= end - k; x++) out.push(list[x]);
  return out;
}

function lowerBound(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

function levels(b, piv, end, a, look = 250) {
  const pts = [];
  for (const i of pivotsIn(piv.hi, end - look, end)) pts.push(b[i].h);
  for (const i of pivotsIn(piv.lo, end - look, end)) pts.push(b[i].l);
  pts.sort((x, y) => x - y);
  const clusters = [];
  for (const p of pts) {
    const last = clusters[clusters.length - 1];
    if (last && p - last.sum / last.n <= 0.5 * a) { last.sum += p; last.n++; }
    else clusters.push({ sum: p, n: 1 });
  }
  const cl = clusters.map(x => ({ price: x.sum / x.n, touches: x.n }));
  const px = b[end].c;
  return {
    support: cl.filter(x => x.price < px - 0.2 * a).sort((x, y) => y.price - x.price).slice(0, 3),
    resistance: cl.filter(x => x.price > px + 0.2 * a).sort((x, y) => x.price - y.price).slice(0, 3),
  };
}

// ---------- chart patterns ----------
function fitLine(idx, val) {
  const n = idx.length, mx = idx.reduce((s, x) => s + x, 0) / n, my = val.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (idx[i] - mx) * (val[i] - my); sxx += (idx[i] - mx) ** 2; }
  const m = sxx ? sxy / sxx : 0, q = my - m * mx;
  const err = Math.max(...idx.map((x, i) => Math.abs(val[i] - (m * x + q))));
  return { m, q, err, at: x => m * x + q };
}

const PATTERN_NAMES = {
  sym_tri: "對稱三角形", asc_tri: "上升三角形", desc_tri: "下降三角形",
  rising_wedge: "上升楔形", falling_wedge: "下降楔形",
  double_top: "雙頂（M頂）", double_bottom: "雙底（W底）",
  hs_top: "頭肩頂", hs_bottom: "頭肩底", bull_flag: "上升旗形", bear_flag: "下降旗形",
};

function triangle(b, piv, A, end) {
  const W = 60, a = A[end];
  const hs = pivotsIn(piv.hi, end - W, end), ls = pivotsIn(piv.lo, end - W, end);
  if (hs.length < 2 || ls.length < 2 || hs.length + ls.length < 5 || !(a > 0)) return null;
  if (end - Math.max(hs[hs.length - 1], ls[ls.length - 1]) > 25) return null;
  const U = fitLine(hs, hs.map(i => b[i].h)), L = fitLine(ls, ls.map(i => b[i].l));
  if (U.err > 0.8 * a || L.err > 0.8 * a) return null;
  const first = Math.min(hs[0], ls[0]);
  const w0 = U.at(first) - L.at(first), w1 = U.at(end) - L.at(end);
  if (w0 < 2 * a || w1 <= 0 || w1 > 0.8 * w0) return null;
  const su = U.m * 20 / a, sl = L.m * 20 / a, flat = 0.3;
  let key, bias;
  if (su < -flat && sl > flat) { key = "sym_tri"; bias = 0; }
  else if (Math.abs(su) <= flat && sl > flat) { key = "asc_tri"; bias = 1; }
  else if (su < -flat && Math.abs(sl) <= flat) { key = "desc_tri"; bias = -1; }
  else if (su > flat && sl > flat && sl > su) { key = "rising_wedge"; bias = -1; }
  else if (su < -flat && sl < -flat && su < sl) { key = "falling_wedge"; bias = 1; }
  else return null;
  const c = b[end].c, up = U.at(end), lo = L.at(end);
  const lines = [{ i1: first, p1: U.at(first), i2: end, p2: up }, { i1: first, p1: L.at(first), i2: end, p2: lo }];
  if (c > up + 0.1 * a) return { key, dir: 1, status: "breakout", level: up, target: up + w0, stop: lo, lines };
  if (c < lo - 0.1 * a) return { key, dir: -1, status: "breakout", level: lo, target: lo - w0, stop: up, lines };
  return { key, dir: bias, status: "forming", level: bias >= 0 ? up : lo,
           target: bias >= 0 ? up + w0 : lo - w0, upper: up, lower: lo, lines };
}

function doubleTop(b, piv, A, end, top) {
  const a = A[end], list = top ? piv.hi : piv.lo, val = i => (top ? b[i].h : b[i].l);
  const ps = pivotsIn(list, end - 120, end);
  if (ps.length < 2 || !(a > 0)) return null;
  const p1 = ps[ps.length - 2], p2 = ps[ps.length - 1];
  if (p2 - p1 < 10 || end - p2 > 30 || Math.abs(val(p1) - val(p2)) > a) return null;
  let t = p1;
  for (let i = p1; i <= p2; i++) if (top ? b[i].l < b[t].l : b[i].h > b[t].h) t = i;
  const neck = top ? b[t].l : b[t].h, peak = top ? Math.max(val(p1), val(p2)) : Math.min(val(p1), val(p2));
  const depth = Math.abs(peak - neck);
  if (depth < 3 * a) return null;
  for (let i = p2 + 1; i <= end; i++) if (top ? b[i].h > peak + 0.5 * a : b[i].l < peak - 0.5 * a) return null;
  const c = b[end].c, dir = top ? -1 : 1;
  const broke = top ? c < neck : c > neck;
  return { key: top ? "double_top" : "double_bottom", dir, status: broke ? "breakout" : "forming", level: neck,
           target: neck + dir * depth, stop: peak,
           lines: [{ i1: p1, p1: peak, i2: end, p2: peak }, { i1: p1, p1: neck, i2: end, p2: neck }] };
}

function headShoulders(b, piv, A, end, top) {
  const a = A[end], list = top ? piv.hi : piv.lo, s = top ? 1 : -1, val = i => (top ? b[i].h : b[i].l);
  const ps = pivotsIn(list, end - 150, end);
  if (ps.length < 3 || !(a > 0)) return null;
  const [l, h, r] = ps.slice(-3);
  if (h - l < 5 || r - h < 5 || end - r > 30) return null;
  if (!(s * (val(h) - val(l)) > 0.5 * a && s * (val(h) - val(r)) > 0.5 * a && Math.abs(val(l) - val(r)) <= 1.5 * a)) return null;
  const ext = (from, to) => {
    let t = from;
    for (let i = from; i <= to; i++) if (top ? b[i].l < b[t].l : b[i].h > b[t].h) t = i;
    return t;
  };
  const t1 = ext(l, h), t2 = ext(h, r), n1 = top ? b[t1].l : b[t1].h, n2 = top ? b[t2].l : b[t2].h;
  const neckAt = i => n1 + (n2 - n1) * (i - t1) / (t2 - t1 || 1);
  for (let i = r + 1; i <= end; i++) if (s * ((top ? b[i].h : b[i].l) - val(h)) > 0) return null;
  const height = Math.abs(val(h) - neckAt(h)), neck = neckAt(end), c = b[end].c, dir = -s;
  const broke = top ? c < neck : c > neck;
  return { key: top ? "hs_top" : "hs_bottom", dir, status: broke ? "breakout" : "forming", level: neck,
           target: neck + dir * height, stop: val(r),
           lines: [{ i1: t1, p1: n1, i2: end, p2: neck }] };
}

function flag(b, A, end) {
  for (let m = 5; m <= 15; m++) {
    const pe = end - m - 1;
    if (pe < 12) return null;
    const a = A[pe];
    let best = 0, ps = -1;
    for (let len = 3; len <= 10; len++) {
      const mv = b[pe].c - b[pe - len].c;
      if (Math.abs(mv) > Math.abs(best)) { best = mv; ps = pe - len; }
    }
    if (!(a > 0) || Math.abs(best) < 4 * a) continue;
    let hi = -Infinity, lo = Infinity;
    for (let i = pe + 1; i < end; i++) { hi = Math.max(hi, b[i].h); lo = Math.min(lo, b[i].l); }
    const up = best > 0;
    if (hi - lo > 0.5 * Math.abs(best)) continue;
    if (up ? b[pe].c - lo > 0.5 * best : hi - b[pe].c > 0.5 * -best) continue;
    const c = b[end].c, dir = up ? 1 : -1;
    const broke = up ? c > hi : c < lo;
    if (!broke && (c > hi || c < lo)) continue;         // broke out the wrong way: no flag
    return { key: up ? "bull_flag" : "bear_flag", dir, status: broke ? "breakout" : "forming",
             level: up ? hi : lo, target: (up ? hi : lo) + best, stop: up ? lo : hi,
             lines: [{ i1: ps, p1: b[ps].c, i2: pe, p2: b[pe].c },
                     { i1: pe + 1, p1: hi, i2: end, p2: hi }, { i1: pe + 1, p1: lo, i2: end, p2: lo }] };
  }
  return null;
}

function detectPatterns(b, piv, A, end) {
  return [triangle(b, piv, A, end), doubleTop(b, piv, A, end, true), doubleTop(b, piv, A, end, false),
          headShoulders(b, piv, A, end, true), headShoulders(b, piv, A, end, false), flag(b, A, end)]
    .filter(Boolean);
}

// Every past breakout of each pattern on this stock: did price move the expected way over the next FWD days?
function patternHistory(b, piv, A) {
  const n = b.length, stats = {}, lastEvent = {};
  for (let end = 60; end < n - FWD; end++) {
    for (const p of detectPatterns(b, piv, A, end)) {
      if (p.status !== "breakout") continue;
      const id = p.key + p.dir;
      if (lastEvent[id] !== undefined && end - lastEvent[id] < 15) { lastEvent[id] = end; continue; }
      lastEvent[id] = end;
      const r = b[end + FWD].c / b[end].c - 1;
      const s = stats[id] || (stats[id] = { key: p.key, dir: p.dir, n: 0, wins: 0, sum: 0 });
      s.n++; s.sum += p.dir * r; if (p.dir * r > 0) s.wins++;
    }
  }
  let ups = 0, tot = 0, sum = 0;
  for (let i = 60; i < n - FWD; i++) { const r = b[i + FWD].c / b[i].c - 1; tot++; sum += r; if (r > 0) ups++; }
  return { stats, base: { upRate: tot ? ups / tot : NaN, avg: tot ? sum / tot : NaN } };
}

// ---------- strategy backtests (daily, long only, trade at the signal day's close) ----------
function runBacktest(c, w, start) {
  const n = c.length;
  let eq = 1, pos = 0, peak = 1, mdd = 0, entryEq = 1, days = 0;
  const trades = [], curve = [];
  for (let i = start; i < n; i++) {
    if (i > start) eq *= 1 + pos * (c[i] / c[i - 1] - 1);
    const nw = w[i];
    if (nw !== pos) {
      eq *= 1 - Math.abs(nw - pos) * COST;
      if (pos === 0) entryEq = eq;
      if (nw === 0) trades.push(eq / entryEq - 1);
      pos = nw;
    }
    if (pos > 0) days++;
    peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1);
    curve.push(eq);
  }
  const years = (n - 1 - start) / 252;
  return {
    cagr: years > 0 ? eq ** (1 / years) - 1 : NaN, mdd, total: eq - 1, trades: trades.length,
    winRate: trades.length ? trades.filter(r => r > 0).length / trades.length : NaN,
    exposure: days / (n - start), open: pos > 0 ? eq / entryEq - 1 : null, curve, years,
  };
}

function stateful(n, step) {                             // step(i, prevWeight) -> new weight
  const w = new Array(n).fill(0);
  let pos = 0;
  for (let i = 0; i < n; i++) { pos = step(i, pos); w[i] = pos; }
  return w;
}

const STRATEGIES = [
  { id: "ma200", term: "long", name: "200 天線趨勢", rule: "收市高過 200 天平均線就持有，跌穿就沽出等。",
    weights: (I) => I.c.map((x, i) => (x > I.ma200[i] ? 1 : 0)) },
  { id: "ruleB", term: "long", name: "200 天線 + 你嘅止蝕規則 B",
    rule: "高過 200 天線買入；跌 8% 止蝕（等跌穿再升返 200 天線先再買）；升 50% 賣一半；其餘跌穿 200 天線先賣。",
    weights: (I) => {
      let entry = 0, half = false, blocked = false;
      return stateful(I.c.length, (i, pos) => {
        const c = I.c[i], above = c > I.ma200[i];
        if (!above) { blocked = false; return 0; }
        if (pos === 0) { if (blocked) return 0; entry = c; half = false; return 1; }
        if (c <= entry * 0.92) { blocked = true; return 0; }
        if (!half && c >= entry * 1.5) { half = true; return 0.5; }
        return pos;
      });
    } },
  { id: "cross", term: "long", name: "50/200 金叉死叉", rule: "50 天線高過 200 天線（金叉）持有，死叉沽出。",
    weights: (I) => I.c.map((_, i) => (I.ma50[i] > I.ma200[i] ? 1 : 0)) },
  { id: "macd", term: "short", name: "MACD 交叉", rule: "MACD 線高過訊號線持有，跌穿沽出。",
    weights: (I) => I.c.map((_, i) => (I.macd[i] > I.signal[i] ? 1 : 0)) },
  { id: "rsi14", term: "short", name: "RSI(14) 超賣反彈", rule: "RSI(14) 低過 30（超賣）買入，高過 70（超買）賣出。",
    weights: (I) => stateful(I.c.length, (i, pos) => (pos === 0 ? (I.rsi14[i] < 30 ? 1 : 0) : (I.rsi14[i] > 70 ? 0 : 1))) },
  { id: "boll", term: "short", name: "布林通道回歸", rule: "收市跌穿布林下軌買入，返到中軌（20 天線）賣出。",
    weights: (I) => stateful(I.c.length, (i, pos) => (pos === 0 ? (I.c[i] < I.bbLo[i] ? 1 : 0) : (I.c[i] > I.ma20[i] ? 0 : 1))) },
  { id: "rsi2", term: "short", name: "RSI(2) 短線反彈（機械人用緊）",
    rule: "高過 200 天線，而 RSI(2) 低過 10 買入；收市高過 5 天線賣出。",
    weights: (I) => stateful(I.c.length, (i, pos) => (pos === 0
      ? (I.c[i] > I.ma200[i] && I.rsi2[i] < 10 ? 1 : 0) : (I.c[i] > I.ma5[i] ? 0 : 1))) },
];

function strategies(I) {
  const n = I.c.length, start = Math.max(210, n - BT_YEARS * 252);
  if (n < 260) return { start, rows: [], hold: null };
  const hold = runBacktest(I.c, I.c.map(() => 1), start);
  const rows = STRATEGIES.map(s => {
    const w = s.weights(I), r = runBacktest(I.c, w, start);
    const now = w[n - 1], prev = w[n - 2];
    const signal = now > prev ? (prev === 0 ? "buy" : "add") : now < prev ? (now === 0 ? "sell" : "trim") : now > 0 ? "hold" : "wait";
    return { id: s.id, term: s.term, name: s.name, rule: s.rule, signal, weight: now, ...r };
  });
  return { start, rows, hold };
}

// ---------- VWAP reversion on 5-minute bars (same rule as the bot) ----------
function vwapStudy(intra, daily, I) {
  const dayIdx = {};
  daily.forEach((x, i) => { dayIdx[x.t.slice(0, 10)] = i; });
  const byDay = {};
  for (const x of intra) (byDay[x.t.slice(0, 10)] = byDay[x.t.slice(0, 10)] || []).push(x);
  const trades = [];
  let today = null;
  for (const d of Object.keys(byDay).sort()) {
    const j = dayIdx[d];
    if (j === undefined || j < 1) continue;
    const a = I.atr[j - 1], up = daily[j - 1].c > I.ma50[j - 1];
    let pv = 0, vol = 0, pos = null, traded = false, vw = NaN;
    for (const x of byDay[d]) {
      const tm = x.t.slice(11, 16);
      if (tm < "09:30" || tm >= "16:00") continue;
      pv += (x.h + x.l + x.c) / 3 * x.v; vol += x.v; vw = vol ? pv / vol : NaN;
      if (pos) {
        let exit = null, why = "";
        if (x.l <= pos.stop) { exit = pos.stop; why = "stop"; }
        else if (x.h >= pos.target) { exit = pos.target; why = "target"; }
        else if (tm >= "15:55") { exit = x.c; why = "close"; }
        if (exit !== null) { trades.push({ day: d, ret: exit / pos.entry - 1 - 2 * COST, why }); pos = null; }
      } else if (!traded && up && tm >= "10:00" && tm < "15:00" && x.c < vw - 0.5 * a) {
        pos = { entry: x.c, stop: x.c - 0.5 * a, target: vw }; traded = true;
      }
    }
    if (pos) { const last = byDay[d][byDay[d].length - 1]; trades.push({ day: d, ret: last.c / pos.entry - 1 - 2 * COST, why: "close" }); }
    today = { day: d, vwap: vw, trigger: vw - 0.5 * a, last: byDay[d][byDay[d].length - 1].c, uptrend: up, atr: a };
  }
  const wins = trades.filter(t => t.ret > 0).length;
  return { trades, n: trades.length, winRate: trades.length ? wins / trades.length : NaN,
           avg: trades.length ? trades.reduce((s, t) => s + t.ret, 0) / trades.length : NaN,
           total: trades.reduce((s, t) => s * (1 + t.ret), 1) - 1, days: Object.keys(byDay).length, today };
}

// ---------- stop-loss / take-profit ----------
// entry: planned buy price (limit / breakout order); defaults to the last close
function exitLevels(I, lv, end, entry) {
  const p = Number.isFinite(entry) && entry > 0 ? entry : I.c[end], a = I.atr[end], rows = [];
  const rr = (stop, tp) => (tp - p) / (p - stop);
  rows.push({ id: "atr_long", name: "波幅 ATR（長線）", how: "止蝕 = 買入價 − 2×ATR；止盈 = +3×ATR / +6×ATR",
              stop: p - 2 * a, tp1: p + 3 * a, tp2: p + 6 * a });
  rows.push({ id: "atr_short", name: "波幅 ATR（短線）", how: "止蝕 = 買入價 − 1×ATR；止盈 = +1.5×ATR / +2×ATR",
              stop: p - a, tp1: p + 1.5 * a, tp2: p + 2 * a });
  rows.push({ id: "pct", name: "固定百分比（規則 B）", how: "止蝕 −8%；+50% 賣一半；其餘跌穿 200 天線先賣",
              stop: p * 0.92, tp1: p * 1.5, tp2: I.ma200[end], tp2Note: "跌穿 200 天線" });
  // levels relative to the entry, not today's price
  const all = [...lv.support, ...lv.resistance];
  const sup = all.filter(x => x.price < p).sort((x, y) => y.price - x.price);
  const res = all.filter(x => x.price > p).sort((x, y) => x.price - y.price);
  const s1 = sup[0], r1 = res[0], r2 = res[1];
  rows.push({ id: "sr", name: "支持位 / 阻力位", how: "止蝕 = 買入價下面最近支持位再低半個 ATR；止盈 = 上面第 1、2 個阻力位",
              stop: s1 ? s1.price - 0.5 * a : NaN, tp1: r1 ? r1.price : NaN, tp2: r2 ? r2.price : NaN,
              note: !r1 ? "上面冇阻力位（接近一年新高），可改用 ATR 止盈" : !s1 ? "下面冇明顯支持位" : "" });
  for (const r of rows) {
    r.riskPct = r.stop / p - 1;
    r.rr = r.tp1 > p && r.stop < p ? rr(r.stop, r.tp1) : NaN;
  }
  return rows;
}

// ---------- rule-based verdict (long term / short term score with reasons) ----------
const okN = x => typeof x === "number" && isFinite(x);
const f2 = x => (okN(x) ? x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const pct = x => (okN(x) ? (x > 0 ? "+" : "") + (x * 100).toFixed(1) + "%" : "—");

function verdicts(d, R) {
  const I = R.I, e = d.length - 1, c = I.c[e], a = I.atr[e];
  const L = [], S = [];
  const add = (arr, pts, txt) => arr.push({ pts, txt });
  // long term
  if (c > I.ma200[e]) add(L, 2, "股價高過 200 天線（" + f2(I.ma200[e]) + "），長期趨勢向上");
  else add(L, -2, "股價低過 200 天線（" + f2(I.ma200[e]) + "），長期趨勢向下");
  if (I.ma50[e] > I.ma200[e]) add(L, 1, "50 天線喺 200 天線之上（金叉狀態）");
  else add(L, -1, "50 天線喺 200 天線之下（死叉狀態）");
  const slope = I.ma200[e] / I.ma200[e - 20] - 1;
  if (slope > 0.005) add(L, 1, "200 天線仲向上斜（過去 20 日 " + pct(slope) + "）");
  else if (slope < -0.005) add(L, -1, "200 天線向下斜（過去 20 日 " + pct(slope) + "）");
  let hi52 = -Infinity; for (let i = Math.max(0, e - 251); i <= e; i++) hi52 = Math.max(hi52, d[i].h);
  const off = c / hi52 - 1;
  if (off < -0.3) add(L, -1, "距離一年高位 " + pct(off) + "，跌咗好多");
  else if (off > -0.05) add(L, 1, "接近一年高位（" + pct(off) + "），強勢");
  // short term
  if (I.macd[e] > I.signal[e]) add(S, 1, "MACD 喺訊號線之上，短線動力向上");
  else add(S, -1, "MACD 喺訊號線之下，短線動力向下");
  if (c > I.ma20[e]) add(S, 1, "股價高過 20 天線"); else add(S, -1, "股價低過 20 天線");
  const r14 = I.rsi14[e], r2 = I.rsi2[e];
  if (r14 > 70) add(S, -1, "RSI(14) " + r14.toFixed(0) + "，超買，追高要小心");
  else if (r14 < 30) add(S, 1, "RSI(14) " + r14.toFixed(0) + "，超賣，有機會反彈");
  if (r2 < 10 && c > I.ma200[e]) add(S, 2, "RSI(2) " + r2.toFixed(0) + " 而且喺 200 天線之上 → 機械人 RSI(2) 策略嘅買入訊號");
  else if (r2 > 90) add(S, -1, "RSI(2) " + r2.toFixed(0) + "，短線升得急，容易回吐");
  if (c < I.bbLo[e]) add(S, 1, "跌穿布林下軌，短線偏離太遠，可能反彈");
  else if (c > I.bbUp[e]) add(S, -1, "升穿布林上軌，短線偏離太遠");
  const s1 = R.levels.support[0], r1 = R.levels.resistance[0];
  if (r1 && r1.price - c < a) add(S, -1, "上面 " + f2(r1.price) + " 有阻力，距離唔夠 1 個 ATR");
  if (s1 && c - s1.price < a) add(S, 1, "下面 " + f2(s1.price) + " 有支持，止蝕位近");
  for (const p of R.patterns) {
    const name = PATTERN_NAMES[p.key];
    if (p.status === "breakout") add(S, 2 * p.dir, name + (p.dir > 0 ? "向上突破" : "向下跌穿") + "（目標 " + f2(p.target) + "）");
    else if (p.dir) add(S, 0, "形成緊" + name + "，未突破（等確認）");
  }
  const sum = arr => arr.reduce((s, x) => s + x.pts, 0);
  const tag = (s, hi, lo) => (s >= hi ? "偏好" : s <= lo ? "偏淡" : "中性");
  const ls = sum(L), ss = sum(S), lt = tag(ls, 3, -2), st = tag(ss, 2, -2);
  const ex = Object.fromEntries(R.exits.map(x => [x.id, x]));
  const actL = { 偏好: "趨勢向上：可以考慮分段買入或者繼續持有。止蝕參考 " + f2(ex.pct.stop) + "（−8%）或者跌穿 200 天線 " + f2(I.ma200[e]) + " 先走。",
                 中性: "訊號唔一致：已有就持有、唔急住加；想買可以等股價企穩 200 天線、或者跌到支持位先分段入。",
                 偏淡: "長期趨勢弱：唔建議新買入；手上有嘅話考慮減持，等重新升返 200 天線之上先再考慮。" }[lt];
  const actS = { 偏好: "短線可以考慮：止蝕 " + f2(ex.atr_short.stop) + "（−1 ATR），第一目標 " + f2(ex.atr_short.tp1) + "。",
                 中性: "短線冇明確方向，觀望為主，等突破或者回調到支持位。",
                 偏淡: "短線偏弱：唔好追入；短炒等 RSI(2) 超賣或者企穩支持位先考慮。" }[st];
  return { long: { tag: lt, score: ls, items: L, act: actL }, short: { tag: st, score: ss, items: S, act: actS } };
}

// ---------- everything for one stock ----------
function analyze(daily, intra) {
  const I = indicators(daily), n = daily.length, end = n - 1;
  const piv = pivots(daily);
  const lv = levels(daily, piv, end, I.atr[end]);
  const patterns = detectPatterns(daily, piv, I.atr, end);
  const hist = patternHistory(daily, piv, I.atr);
  return {
    I, piv, levels: lv, patterns, patternHistory: hist, strategies: strategies(I),
    vwap: intra && intra.length ? vwapStudy(intra, daily, I) : null, exits: exitLevels(I, lv, end),
  };
}

const api = { COST, FWD, PATTERN_NAMES, STRATEGIES, sma, ema, rsi, atr, indicators, pivots, levels,
              detectPatterns, patternHistory, runBacktest, strategies, vwapStudy, exitLevels, analyze, verdicts };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.Analyzer = api;
})(this);
