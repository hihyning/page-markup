// Page Markup: in-page overlay. Injected by the side panel into the tab under review.
(() => {
  if (window.__pageMarkup) { window.__pageMarkup.activate(); return; }

  const KEY = "pm:" + location.origin + location.pathname;
  const UI_KEY = "pm:ui";
  const CAT_COLORS = {
    typography: "#d6336c", spacing: "#0c8f6a", layout: "#3b5bdb",
    color: "#d9480f", content: "#7048e8", other: "#5c6370"
  };
  const SVGNS = "http://www.w3.org/2000/svg";

  let review = null;           // {url,title,vp,notes:[...]}
  let ui = { tool: "pin", cat: "typography", sticker: "Too tight", selected: null, active: true };
  let draft = null, drag = null, measureFirst = null, hiddenFixed = [], capturing = false;

  /* ---------- shadow host ---------- */
  const host = document.createElement("page-markup-root");
  host.style.cssText = "position:absolute!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483646!important;display:block!important;pointer-events:none!important;margin:0!important;padding:0!important;border:0!important;transform:none!important";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host{all:initial}
    *{box-sizing:border-box}
    .layer{position:absolute;top:0;left:0;pointer-events:none;cursor:crosshair}
    .layer.on{pointer-events:auto}
    svg.marks{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}
    svg.marks .mark{pointer-events:visiblePainted;cursor:move}
    svg.marks text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;pointer-events:none}
    .hover{position:absolute;pointer-events:none;outline:2px solid #2f4bdb;outline-offset:1px;background:rgba(47,75,219,.08);display:none}
    .hover .tag{position:absolute;left:-2px;bottom:100%;margin-bottom:4px;background:#191c24;color:#fff;font:600 11px/1.3 ui-monospace,Menlo,monospace;padding:3px 6px;border-radius:4px;white-space:nowrap}
    .hover.below .tag{bottom:auto;top:100%;margin:4px 0 0}
    .pill{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);pointer-events:auto;background:#191c24;color:#fff;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;padding:7px 12px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;white-space:nowrap}
    .pill i{width:9px;height:9px;border-radius:50%;display:inline-block}
    .pill button{all:unset;cursor:pointer;opacity:.75;font-weight:600}
    .pill button:hover{opacity:1}
    .hidden{display:none!important}
  </style>
  <div class="layer"></div>
  <svg class="marks" xmlns="${SVGNS}"></svg>
  <div class="hover"><span class="tag"></span></div>
  <div class="pill"><i></i><span class="pilltext"></span><button type="button" class="pillbrowse">Esc to browse</button></div>`;
  const layer = root.querySelector(".layer"), svg = root.querySelector("svg.marks"), hover = root.querySelector(".hover"),
    pill = root.querySelector(".pill"), pillText = root.querySelector(".pilltext");
  document.documentElement.appendChild(host);
  root.querySelector(".pillbrowse").addEventListener("click", () => setUI({ tool: "browse" }));

  /* ---------- storage ---------- */
  const store = chrome.storage.local;
  async function load() {
    const got = await store.get([KEY, UI_KEY]);
    review = got[KEY] || { url: location.href, title: document.title, vp: innerWidth, notes: [] };
    if (got[UI_KEY]) ui = { ...ui, ...got[UI_KEY] };
    render();
  }
  async function mutate(fn) {
    const got = await store.get(KEY);
    const r = got[KEY] || { url: location.href, title: document.title, vp: innerWidth, notes: [] };
    fn(r); r.updated = Date.now();
    await store.set({ [KEY]: r });
    review = r; render();
  }
  function setUI(patch) { ui = { ...ui, ...patch }; store.set({ [UI_KEY]: ui }); render(); }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch[KEY]) { review = ch[KEY].newValue || { notes: [] }; if (!drag) render(); }
    if (ch[UI_KEY]) { ui = { ...ui, ...ch[UI_KEY].newValue }; measureFirst = null; render(); }
  });

  /* ---------- element helpers ---------- */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    const uniqId = e => e.id && !/^\d/.test(e.id) && document.querySelectorAll("#" + CSS.escape(e.id)).length === 1;
    if (uniqId(el)) return "#" + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (uniqId(el)) { parts.unshift("#" + CSS.escape(el.id)); break; }
      let p = el.tagName.toLowerCase();
      const par = el.parentElement;
      if (par) {
        const sib = [...par.children].filter(c => c.tagName === el.tagName);
        if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(el) + 1})`;
      }
      parts.unshift(p); el = par;
    }
    return parts.join(" > ");
  }
  function find(sel) { try { return sel ? document.querySelector(sel) : null; } catch { return null; } }
  function docRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }
  function elementAt(cx, cy) {
    const list = document.elementsFromPoint(cx, cy).filter(e => e !== host && e !== document.documentElement && e !== document.body);
    return list[0] || document.body;
  }
  function anchorFor(px, py) {
    const el = elementAt(px - scrollX, py - scrollY), r = docRect(el);
    return { sel: cssPath(el), rx: r.w ? (px - r.x) / r.w : 0, ry: r.h ? (py - r.y) / r.h : 0, x: px, y: py };
  }
  function resolve(a) {
    if (!a) return null;
    const el = find(a.sel);
    if (el) { const r = docRect(el); if (r.w || r.h) return { x: r.x + a.rx * r.w, y: r.y + a.ry * r.h, ok: true }; }
    return { x: a.x, y: a.y, ok: false };
  }
  const px1 = v => (Math.round(parseFloat(v) * 10) / 10) + "px";
  function typeInfo(el) {
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    const lh = cs.lineHeight === "normal" ? "normal" : px1(cs.lineHeight);
    const ls = cs.letterSpacing === "normal" ? "" : ` · tracking ${cs.letterSpacing}`;
    const type = `${fam} ${px1(cs.fontSize)}/${lh} · ${cs.fontWeight}${ls}`;
    const sp = `margin ${px1(cs.marginTop)} top, ${px1(cs.marginBottom)} bottom`;
    let tag = el.tagName.toLowerCase();
    if (el.classList.length) tag += "." + [...el.classList].slice(0, 2).join(".");
    const raw = el === document.body || el === document.documentElement ? "" : (el.innerText || "").trim().replace(/\s+/g, " ");
    const text = raw.length > 400 ? "" : raw.slice(0, 60);
    return { tag, type, spacing: sp, text };
  }

  /* ---------- measure geometry ---------- */
  function measureGeom(n) {
    const ea = find(n.ea?.sel), eb = find(n.eb?.sel);
    const A = ea ? docRect(ea) : n.ea?.r, B = eb ? docRect(eb) : n.eb?.r;
    if (!A || !B) return null;
    let [a, b] = A.y <= B.y ? [A, B] : [B, A];
    if (b.y >= a.y + a.h) {             // vertical gap
      const l = Math.max(a.x, b.x), r = Math.min(a.x + a.w, b.x + b.w);
      const x = l < r ? (l + r) / 2 : a.x + a.w / 2;
      return { x1: x, y1: a.y + a.h, x2: x, y2: b.y, gap: Math.round(b.y - (a.y + a.h)), dir: "v" };
    }
    [a, b] = A.x <= B.x ? [A, B] : [B, A];
    if (b.x >= a.x + a.w) {             // horizontal gap
      const t = Math.max(a.y, b.y), btm = Math.min(a.y + a.h, b.y + b.h);
      const y = t < btm ? (t + btm) / 2 : a.y + a.h / 2;
      return { x1: a.x + a.w, y1: y, x2: b.x, y2: y, gap: Math.round(b.x - (a.x + a.w)), dir: "h" };
    }
    return { x1: A.x, y1: A.y, x2: B.x, y2: B.y, gap: 0, dir: "overlap" };
  }

  /* geometry in document CSS px, used by the published viewer */
  function geomOf(n) {
    if (n.kind === "measure") return measureGeom(n);
    const a = resolve(n.a);
    if (!a) return null;
    if (n.kind === "pin" || n.kind === "sticker") return { x: a.x, y: a.y, lost: !a.ok };
    const b = resolve(n.b);
    if (n.kind === "arrow") return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, lost: !a.ok || !b.ok };
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), lost: !a.ok || !b.ok };
  }
  const topY = g => !g ? 0 : g.y ?? Math.min(g.y1, g.y2);
  // Notes belong to the layout they were placed in: under 768px wide is Mobile, otherwise Desktop.
  const layoutW = () => document.documentElement.clientWidth;
  const currentView = () => layoutW() < 768 ? "mobile" : "desktop";
  const viewOf = n => n.view || "mobile";
  function ordered() {
    const v = currentView();
    return [...(review?.notes || [])].filter(n => viewOf(n) === v).sort((p, q) => (p.y - q.y) || (p.created - q.created));
  }

  /* ---------- render ---------- */
  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent && parent.appendChild(e); return e;
  }
  function badge(g, x, y, n, col) {
    el("circle", { cx: x, cy: y, r: 11, fill: col, stroke: "#fff", "stroke-width": 2 }, g);
    const t = el("text", { x, y: y + 4, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "#fff" }, g);
    t.textContent = n;
  }
  function drawNote(n, num, g, sel) {
    const col = CAT_COLORS[n.cat] || "#888", geo = geomOf(n);
    if (!geo) return;
    if (n.kind === "pin") {
      el("path", { d: `M${geo.x},${geo.y} l-8,-14 a11,11 0 1 1 16,0 z`, fill: col, stroke: "#fff", "stroke-width": 2 }, g);
      const t = el("text", { x: geo.x, y: geo.y - 18, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "#fff" }, g); t.textContent = num;
      if (sel) el("circle", { cx: geo.x, cy: geo.y - 19, r: 18, fill: "none", stroke: col, "stroke-dasharray": "4 3", "stroke-width": 1.5 }, g);
    } else if (n.kind === "sticker") {
      const w = n.sticker.length * 6.6 + 40;
      el("rect", { x: geo.x, y: geo.y - 12, width: w, height: 24, rx: 12, fill: col, stroke: sel ? "#191c24" : "#fff", "stroke-width": 2 }, g);
      badge(g, geo.x, geo.y, num, col);
      const t = el("text", { x: geo.x + 17, y: geo.y + 4, "font-size": 12, "font-weight": 700, fill: "#fff" }, g); t.textContent = n.sticker;
    } else if (n.kind === "arrow") {
      el("line", { x1: geo.x1, y1: geo.y1, x2: geo.x2, y2: geo.y2, stroke: "transparent", "stroke-width": 14 }, g);
      el("line", { x1: geo.x1, y1: geo.y1, x2: geo.x2, y2: geo.y2, stroke: col, "stroke-width": sel ? 4 : 3, "marker-end": `url(#pm-ah-${n.cat})` }, g);
      badge(g, geo.x1, geo.y1, num, col);
    } else if (n.kind === "measure") {
      const v = geo.dir !== "h";
      el("line", { x1: geo.x1, y1: geo.y1, x2: geo.x2, y2: geo.y2, stroke: "transparent", "stroke-width": 14 }, g);
      el("line", { x1: geo.x1, y1: geo.y1, x2: geo.x2, y2: geo.y2, stroke: col, "stroke-width": 2 }, g);
      [[geo.x1, geo.y1], [geo.x2, geo.y2]].forEach(([x, y]) => el("line", v ? { x1: x - 7, y1: y, x2: x + 7, y2: y, stroke: col, "stroke-width": 2 } : { x1: x, y1: y - 7, x2: x, y2: y + 7, stroke: col, "stroke-width": 2 }, g));
      const lbl = geo.dir === "overlap" ? "overlap" : geo.gap + "px", w = lbl.length * 7.4 + 12;
      const mx = (geo.x1 + geo.x2) / 2, my = (geo.y1 + geo.y2) / 2;
      el("rect", { x: mx + 14, y: my - 10, width: w, height: 20, rx: 4, fill: col }, g);
      const t = el("text", { x: mx + 14 + w / 2, y: my + 4, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "#fff", "font-family": "ui-monospace,Menlo,monospace" }, g); t.textContent = lbl;
      badge(g, mx - 14, my, num, col);
    } else {
      if (sel) el("rect", { x: geo.x - 5, y: geo.y - 5, width: geo.w + 10, height: geo.h + 10, fill: "none", stroke: col, "stroke-dasharray": "6 4", "stroke-width": 1.5 }, g);
      el("rect", { x: geo.x, y: geo.y, width: geo.w, height: geo.h, fill: n.kind === "highlight" ? col : "transparent", "fill-opacity": n.kind === "highlight" ? 0.2 : 0, stroke: col, "stroke-width": n.kind === "box" ? 3 : 1.5 }, g);
      badge(g, geo.x, geo.y, num, col);
    }
  }
  function render() {
    const de = document.documentElement;
    for (const e of [layer, svg]) { e.style.width = "0px"; e.style.height = "0px"; } // measure the page without our own layer
    const W = Math.max(de.scrollWidth, de.clientWidth), H = Math.max(de.scrollHeight, de.clientHeight);
    for (const e of [layer, svg]) { e.style.width = W + "px"; e.style.height = H + "px"; }
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.innerHTML = "";
    const show = ui.active && !capturing;
    host.style.setProperty("display", show || capturing ? "block" : "none", "important");
    svg.classList.toggle("hidden", !show); pill.classList.toggle("hidden", !show);
    layer.classList.toggle("on", show && ui.tool !== "browse");
    if (!show) { hover.style.display = "none"; return; }
    const defs = el("defs", {}, svg);
    for (const c in CAT_COLORS) {
      const m = el("marker", { id: "pm-ah-" + c, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, defs);
      el("path", { d: "M0,0L10,5L0,10z", fill: CAT_COLORS[c] }, m);
    }
    ordered().forEach((n, i) => {
      if (n.done) return;
      const g = el("g", { class: "mark", "data-id": n.id }, svg);
      drawNote(n, i + 1, g, n.id === ui.selected);
    });
    if (draft) {
      const col = CAT_COLORS[ui.cat];
      if (draft.kind === "arrow") el("line", { x1: draft.x, y1: draft.y, x2: draft.x2, y2: draft.y2, stroke: col, "stroke-width": 3, "stroke-dasharray": "5 3" }, svg);
      else el("rect", { x: Math.min(draft.x, draft.x2), y: Math.min(draft.y, draft.y2), width: Math.abs(draft.x2 - draft.x), height: Math.abs(draft.y2 - draft.y), fill: col, "fill-opacity": draft.kind === "highlight" ? .2 : 0, stroke: col, "stroke-width": 2, "stroke-dasharray": "5 3" }, svg);
    }
    if (measureFirst) { const r = docRect(measureFirst); el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: CAT_COLORS[ui.cat], "fill-opacity": .15, stroke: CAT_COLORS[ui.cat], "stroke-width": 2 }, svg); }
    const names = { browse: "Browsing", pin: "Pin", highlight: "Highlight", box: "Box", arrow: "Arrow", measure: measureFirst ? "Measure: now click the second element" : "Measure: click the first element", sticker: "Sticker · " + ui.sticker };
    pill.querySelector("i").style.background = CAT_COLORS[ui.cat];
    pillText.textContent = `${currentView() === "mobile" ? "Mobile" : "Desktop"} ${layoutW()}px · ${names[ui.tool] || ui.tool}`;
    root.querySelector(".pillbrowse").textContent = ui.tool === "browse" ? "P to pin" : "Esc to browse";
  }

  /* ---------- interaction ---------- */
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  function newNote(base, infoEl) {
    const info = infoEl ? typeInfo(infoEl) : null;
    const n = { id: uid(), cat: ui.cat, note: "", from: "", to: "", done: false, created: Date.now(), view: currentView(), lw: layoutW(), ...base };
    if (info) { n.element = info.tag; n.styles = info.type; n.spacing = info.spacing; n.excerpt = info.text; }
    n.y = topY(geomOf(n));
    return n;
  }
  async function addNote(n) {
    await mutate(r => r.notes.push(n));
    setUI({ selected: n.id, focus: n.id + ":" + Date.now() });
  }
  function showHover(cx, cy) {
    if (!["pin", "sticker", "measure"].includes(ui.tool)) { hover.style.display = "none"; return; }
    const t = elementAt(cx, cy), r = docRect(t), info = typeInfo(t);
    Object.assign(hover.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    hover.classList.toggle("below", r.y - scrollY < 28);
    hover.querySelector(".tag").textContent = `${info.tag} · ${info.type}`;
  }
  function markAt(e) { const p = e.composedPath ? e.composedPath() : []; const g = p.find(x => x.classList && x.classList.contains && x.classList.contains("mark")); return g ? g.dataset.id : null; }

  svg.addEventListener("pointerdown", e => {
    const id = markAt(e); if (!id) return;
    e.preventDefault(); e.stopPropagation();
    const n = review.notes.find(x => x.id === id);
    setUI({ selected: id });
    if (n && n.kind !== "measure") { drag = { id, sx: e.pageX, sy: e.pageY, a: resolve(n.a), b: n.b ? resolve(n.b) : null, moved: false }; svg.setPointerCapture(e.pointerId); }
  });
  svg.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.pageX - drag.sx, dy = e.pageY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    const n = review.notes.find(x => x.id === drag.id); if (!n) return;
    n.a = { ...n.a, sel: null, x: drag.a.x + dx, y: drag.a.y + dy };
    if (drag.b) n.b = { ...n.b, sel: null, x: drag.b.x + dx, y: drag.b.y + dy };
    render();
  });
  svg.addEventListener("pointerup", async e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { render(); return; }
    const dx = e.pageX - d.sx, dy = e.pageY - d.sy;
    host.style.setProperty("pointer-events", "none", "important");
    const na = anchorFor(d.a.x + dx, d.a.y + dy), nb = d.b ? anchorFor(d.b.x + dx, d.b.y + dy) : null;
    await mutate(r => { const n = r.notes.find(x => x.id === d.id); if (!n) return; n.a = na; if (nb) n.b = nb; n.y = topY(geomOf(n)); });
  });

  layer.addEventListener("pointermove", e => {
    if (draft) { draft.x2 = e.pageX; draft.y2 = e.pageY; render(); return; }
    showHover(e.clientX, e.clientY);
  });
  layer.addEventListener("pointerleave", () => { hover.style.display = "none"; });
  layer.addEventListener("pointerdown", async e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const t = ui.tool;
    if (t === "pin" || t === "sticker") {
      const target = elementAt(e.clientX, e.clientY);
      await addNote(newNote({ kind: t, sticker: t === "sticker" ? ui.sticker : null, a: anchorFor(e.pageX, e.pageY) }, target));
      return;
    }
    if (t === "measure") {
      const target = elementAt(e.clientX, e.clientY);
      if (!measureFirst) { measureFirst = target; render(); return; }
      if (target === measureFirst || target.contains(measureFirst) || measureFirst.contains(target)) { measureFirst = target; render(); return; }
      const A = measureFirst; measureFirst = null;
      const n = newNote({ kind: "measure", ea: { sel: cssPath(A), r: docRect(A) }, eb: { sel: cssPath(target), r: docRect(target) } }, A);
      const g = measureGeom(n);
      n.from = g ? (g.dir === "overlap" ? "overlapping" : g.gap + "px") : "";
      n.y = topY(g);
      const tb = typeInfo(target);
      n.styles = `${n.element} → ${tb.tag}`;
      n.spacing = `${n.spacing}; next: ${tb.spacing}`;
      await addNote(n);
      return;
    }
    draft = { kind: t, x: e.pageX, y: e.pageY, x2: e.pageX, y2: e.pageY };
    layer.setPointerCapture(e.pointerId);
  });
  layer.addEventListener("pointerup", async e => {
    if (!draft) return;
    const d = draft; draft = null;
    if (Math.hypot(d.x2 - d.x, d.y2 - d.y) < 8) { render(); return; }
    const a = anchorFor(d.x, d.y), b = anchorFor(d.x2, d.y2);
    const target = elementAt(d.x - scrollX, d.y - scrollY);
    await addNote(newNote({ kind: d.kind, a, b }, target));
  });

  const KEYS = { p: "pin", h: "highlight", b: "box", a: "arrow", m: "measure", s: "sticker" };
  window.addEventListener("keydown", e => {
    if (!ui.active) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { measureFirst = null; draft = null; setUI({ tool: "browse", selected: null }); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && ui.selected) {
      e.preventDefault(); const id = ui.selected;
      mutate(r => { r.notes = r.notes.filter(n => n.id !== id); }); setUI({ selected: null }); return;
    }
    const tool = KEYS[e.key.toLowerCase()];
    if (tool) { e.preventDefault(); setUI({ tool }); }
  }, true);

  let lastSize = "";
  setInterval(() => {
    if (drag || draft || capturing || !ui.active) return;
    const s = document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight;
    if (s !== lastSize) { lastSize = s; render(); }
  }, 700);
  addEventListener("resize", () => render());

  /* ---------- capture support ---------- */
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function hideFixed() {
    if (hiddenFixed.length) return;
    for (const e of document.querySelectorAll("body *")) {
      if (e === host) continue;
      const cs = getComputedStyle(e);
      if (cs.position === "fixed" && cs.visibility !== "hidden") { hiddenFixed.push([e, e.style.getPropertyValue("visibility"), e.style.getPropertyPriority("visibility")]); e.style.setProperty("visibility", "hidden", "important"); }
    }
  }
  function restoreFixed() { for (const [e, v, p] of hiddenFixed) { if (v) e.style.setProperty("visibility", v, p); else e.style.removeProperty("visibility"); } hiddenFixed = []; }
  function allGeoms() {
    return ordered().map(n => ({ id: n.id, geom: geomOf(n) }));
  }
  let savedScroll = 0;
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    (async () => {
      switch (msg.type) {
        case "ping": return { ok: true, url: location.href, title: document.title, vp: innerWidth, lw: layoutW(), view: currentView() };
        case "geoms": {
          // refresh stored y so numbering follows the page top to bottom
          const g = allGeoms();
          await mutate(r => r.notes.forEach(n => { const m = g.find(x => x.id === n.id); if (m?.geom) n.y = topY(m.geom); }));
          return { geoms: allGeoms(), docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, vp: innerWidth, lw: layoutW(), view: currentView() };
        }
        case "scrollTo": {
          const n = review.notes.find(x => x.id === msg.id), g = n && geomOf(n);
          if (g) scrollTo({ top: Math.max(0, topY(g) - innerHeight / 3), behavior: "smooth" });
          return { ok: !!g };
        }
        case "capture:prepare": {
          capturing = true; savedScroll = scrollY; render();
          host.style.setProperty("display", "none", "important");
          const step = Math.max(200, innerHeight * 0.8);
          for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 120; y += step, i++) { scrollTo(0, y); await wait(msg.lazyDelay || 140); }
          scrollTo(0, 0); await wait(500);
          return { docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, vpH: innerHeight, vpW: document.documentElement.clientWidth, lw: layoutW(), view: currentView(), geoms: allGeoms() };
        }
        case "capture:scroll": {
          if (msg.hideFixed) hideFixed();
          scrollTo(0, msg.y); await wait(msg.settle || 350);
          return { y: scrollY, docH: document.documentElement.scrollHeight };
        }
        case "capture:finish": {
          restoreFixed(); capturing = false;
          scrollTo(0, savedScroll); render();
          return { ok: true };
        }
        case "deactivate": ui.active = false; render(); return { ok: true };
      }
    })().then(reply);
    return true;
  });

  window.__pageMarkup = { activate() { setUI({ active: true }); load(); } };
  load();
})();
