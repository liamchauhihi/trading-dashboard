/* Shared by events.html, news.html and analyzer.html: key-date cards (with add-to-calendar) and news cards.
   Everything takes a ctx = { held: [symbols you hold], stats: events.json "stats" }. Exposed as window.FEED. */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const ok = x => typeof x === "number" && isFinite(x);
  const pct = (x, d = 1, sign = true) => (ok(x) ? (sign && x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%" : "—");
  const TYPE = {
    earnings: ["業績", "#2F4FA8"], fomc: ["議息", "#C2362B"], cpi: ["通脹", "#C0661A"], jobs: ["就業", "#18794E"],
    pce: ["PCE", "#B8860B"], gdp: ["GDP", "#2A8A9A"], opex: ["期權結算", "#8A3FA0"], other: ["其他", "#5A6577"],
  };
  const WD = ["日", "一", "二", "三", "四", "五", "六"];

  const parse = d => new Date(d + "T00:00:00");
  const dayStr = t => t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  const todayStr = () => dayStr(new Date());
  const addDays = (s, n) => { const t = parse(s); t.setDate(t.getDate() + n); return dayStr(t); };
  const monday = s => { const t = parse(s); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return dayStr(t); };
  const up = s => String(s || "").toUpperCase();
  const affects = e => (e.affects || []).map(up);

  // does this event touch one of `syms`? (its own stock, or listed as affected)
  const about = (e, syms) => syms.includes(up(e.sym)) || affects(e).some(s => syms.includes(s));

  function history(e, ctx) {
    const st = ctx.stats || {}, s = up(e.sym);
    if (e.type === "earnings" && st[s] && st[s].earn) {
      const x = st[s].earn, t = st[s].typical2d;
      return "📊 " + esc(s) + " 過去 " + x.n + " 次業績後兩日平均郁 <b>" + pct(x.avgAbs, 1, false) + "</b>（平時 " + pct(t, 1, false) + "，" +
        (x.avgAbs > 2 * t ? "大好多" : "大啲") + "），" + x.up + " 次升 " + (x.n - x.up) + " 次跌，最多 " + pct(x.maxAbs, 1, false) + "。";
    }
    if (e.type === "fomc") {
      const rows = ["SPY"].concat(ctx.held.filter(h => h !== "SPY")).filter(h => st[h] && st[h].fomc)
        .map(h => esc(h) + " " + pct(st[h].fomc.avgAbs, 1, false) + "（平時 " + pct(st[h].typical1d, 1, false) + "）");
      return rows.length ? "📊 過去議息當日平均郁：" + rows.join("、") : "";
    }
    return "";
  }

  function evCard(e, ctx) {
    const [label, color] = TYPE[e.type] || TYPE.other;
    const t = parse(e.date), dd = Math.round((t - parse(todayStr())) / 86400000);
    const aff = affects(e);
    const affHtml = aff.map(s => '<span class="chip ' + (ctx.held.includes(s) ? "warn" : "plain") + '">' + esc(s) + "</span>").join(" ");
    const id = ctx.anchors && e.type === "earnings" && e.sym ? ' id="' + esc(up(e.sym)) + '"' : "";
    const h = history(e, ctx);
    return '<article class="ev' + (about(e, ctx.held) ? " mine" : "") + '" style="--c:' + color + '"' + id + ">" +
      '<div class="d">' + esc(e.date.slice(5).replace("-", "/")) + "<small>星期" + WD[t.getDay()] + " · " + (dd === 0 ? "今日" : dd === 1 ? "聽日" : dd + " 日後") + "</small></div>" +
      '<div class="body"><div class="title"><span class="chip tchip" style="--c:' + color + '">' + label + "</span><b>" + esc(e.name || "") + "</b>" +
        (e.confidence === "estimated" ? '<span class="chip warn">日期未正式確認</span>' : "") + "</div>" +
      (e.time ? '<div class="note">🕒 ' + esc(e.time) + "</div>" : "") +
      (e.why ? '<div><span class="k">點解重要</span>' + esc(e.why) + "</div>" : "") +
      (e.impact ? '<div><span class="k">可能影響</span>' + esc(e.impact) + "</div>" : "") +
      (e.watch ? '<div><span class="k">要睇咩</span>' + esc(e.watch) + "</div>" : "") +
      (ok(e.epsEst) ? '<div class="note">市場預期每股盈利 <span class="num">$' + e.epsEst.toFixed(2) + "</span></div>" : "") +
      (affHtml ? '<div><span class="k">相關</span>' + affHtml + "</div>" : "") +
      (h ? '<div class="hist">' + h + "</div>" : "") +
      '<div class="cal"><a href="' + esc(gcal(e)) + '" target="_blank" rel="noopener">＋ Google 日曆</a>' +
      '<button type="button" data-ics="' + esc(key(e)) + '">＋ Apple／Outlook 日曆</button></div>' +
      "</div></article>";
  }

  // ---------- add to calendar (all-day events; the exact time is in the notes) ----------
  const key = e => e.date + "|" + e.type + "|" + (e.sym || "") + "|" + (e.name || "");
  const ymd = s => s.replace(/-/g, "");
  const calTitle = e => (TYPE[e.type] || TYPE.other)[0] + "｜" + (e.name || "");
  function calNotes(e) {
    return [e.time && "時間：" + e.time, e.why && "點解重要：" + e.why, e.impact && "可能影響：" + e.impact, e.watch && "要睇咩：" + e.watch,
            "詳情：" + new URL("events.html", location.href).href].filter(Boolean).join("\n");
  }
  function gcal(e) {
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(calTitle(e)) +
      "&dates=" + ymd(e.date) + "/" + ymd(addDays(e.date, 1)) + "&details=" + encodeURIComponent(calNotes(e));
  }
  function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) | 0; return h; }
  function ics(evs) {
    const q = s => String(s).replace(/\\/g, "\\\\").replace(/[;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//trading-dashboard//events//ZH", "CALSCALE:GREGORIAN"];
    for (const e of evs) lines.push("BEGIN:VEVENT", "UID:" + ymd(e.date) + "-" + e.type + "-" + (e.sym || "x") + "-" + Math.abs(hash(key(e))) + "@trading-dashboard",
      "DTSTAMP:" + stamp, "DTSTART;VALUE=DATE:" + ymd(e.date), "DTEND;VALUE=DATE:" + ymd(addDays(e.date, 1)),
      "SUMMARY:" + q(calTitle(e)), "DESCRIPTION:" + q(calNotes(e)), "END:VEVENT");
    lines.push("END:VCALENDAR");
    const a = document.createElement("a");
    // RFC 5545: lines over 75 bytes are folded (continuation lines start with a space)
    const fold = l => { const out = []; let cur = "", n = 0;
      for (const ch of l) { const b = new TextEncoder().encode(ch).length;
        if (n + b > 74) { out.push(cur); cur = " "; n = 1; }
        cur += ch; n += b; }
      return out.concat(cur).join("\r\n"); };
    a.href = URL.createObjectURL(new Blob([lines.map(fold).join("\r\n") + "\r\n"], { type: "text/calendar" }));
    a.download = evs.length === 1 ? ymd(evs[0].date) + "_" + (evs[0].sym || evs[0].type) + ".ics" : "重要日子.ics";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // one delegated click handler for every [data-ics] button inside `root`; list() returns the events on screen
  function bindIcs(root, list) {
    root.addEventListener("click", ev => {
      const b = ev.target.closest("[data-ics]");
      if (b) ics(list().filter(e => key(e) === b.dataset.ics));
    });
  }

  // ---------- news ----------
  const DIR = { up: ["▲ 利好", "gain"], down: ["▼ 利淡", "loss"], mixed: ["◆ 有好有壞", "warn"] };
  const LEVEL = { high: ["重要", "loss"], medium: ["一般", "plain"], low: ["小事", "plain"] };
  const newsAbout = (n, syms) => (n.affects || []).some(a => syms.includes(up(a.sym)));
  // news.json times are Hong Kong time "YYYY-MM-DD HH:MM"
  function ago(t) {
    const ms = Date.now() - new Date(t.replace(" ", "T") + ":00+08:00").getTime(), h = ms / 3600000;
    return h < 1 ? Math.max(1, Math.round(ms / 60000)) + " 分鐘前" : h < 24 ? Math.round(h) + " 小時前" : Math.round(h / 24) + " 日前";
  }
  // only = show just this stock's line in the "affects" list (analyzer page)
  function newsCard(n, ctx, only) {
    const [lv, lvc] = LEVEL[n.level] || LEVEL.medium;
    const aff = (n.affects || []).filter(a => !only || up(a.sym) === only)
      .sort((a, b) => ctx.held.includes(up(b.sym)) - ctx.held.includes(up(a.sym)));
    const mine = newsAbout(n, ctx.held);
    return '<article class="nw' + (mine ? " mine" : "") + '"><div class="title">' +
      '<span class="chip ' + lvc + '">' + lv + "</span>" +
      (n.url ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener"><b>' + esc(n.headline) + "</b></a>" : "<b>" + esc(n.headline) + "</b>") + "</div>" +
      '<div class="note">' + esc(n.time) + "（" + ago(n.time) + "）" + (n.source ? " · " + esc(n.source) : "") + "</div>" +
      (n.summary ? "<div>" + esc(n.summary) + "</div>" : "") +
      (aff.length ? '<ul class="aff">' + aff.map(a => { const [t, c] = DIR[a.dir] || DIR.mixed;
        return '<li><span class="chip ' + (ctx.held.includes(up(a.sym)) ? "warn" : "plain") + ' num">' + esc(up(a.sym)) + '</span><span class="' + c + '">' + t +
          "</span>" + (a.why ? '<span class="why">' + esc(a.why) + "</span>" : "") + "</li>"; }).join("") + "</ul>" : "") +
      (n.takeaway ? '<div class="take"><span class="k">對你嘅意思</span>' + esc(n.takeaway) + "</div>" : "") +
      "</article>";
  }

  window.FEED = { esc, ok, pct, TYPE, parse, todayStr, addDays, monday, up, about, evCard, key, gcal, ics, bindIcs,
                  newsAbout, newsCard, ago };
})();
