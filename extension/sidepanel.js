// Page Markup side panel: tools, notes, capture, publish.
const $ = s => document.querySelector(s);
const CATS = [["typography", "Typography"], ["spacing", "Spacing"], ["layout", "Layout"], ["color", "Color"], ["content", "Content"], ["other", "Other"]];
const CAT_LABEL = Object.fromEntries(CATS);
const STICKERS = ["Too tight", "Too loose", "Size up", "Size down", "Weight", "Line height", "Tracking", "Align", "Widow / orphan", "Inconsistent", "Looks good"];
const KIND = { pin: "Pin", highlight: "Highlight", box: "Box", arrow: "Arrow", measure: "Gap", sticker: "Sticker" };
const ICON = {
  browse: '<path d="M5 3l11 8-5 1.4L8.6 18z" fill="currentColor"/>',
  pin: '<circle cx="10" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 13v5" stroke="currentColor" stroke-width="2"/>',
  highlight: '<rect x="2" y="6" width="16" height="8" rx="1" fill="currentColor" opacity=".45"/><path d="M2 14h16" stroke="currentColor" stroke-width="2"/>',
  box: '<rect x="3" y="4" width="14" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>',
  arrow: '<path d="M3 17L16 4M16 4h-7M16 4v7" fill="none" stroke="currentColor" stroke-width="2"/>',
  measure: '<path d="M10 2v16M6 2h8M6 18h8" fill="none" stroke="currentColor" stroke-width="2"/>',
  sticker: '<rect x="2" y="6" width="16" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>'
};
const TOOLS = [["browse", "Browse"], ["pin", "Pin"], ["highlight", "Highlight"], ["box", "Box"], ["arrow", "Arrow"], ["measure", "Gap"], ["sticker", "Sticker"]];
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UI_KEY = "pm:ui", GH_KEY = "pm:gh";
const store = chrome.storage.local;

let tab = null, key = null, review = null, ui = { tool: "pin", cat: "typography", sticker: STICKERS[0], selected: null, active: true };
let gh = { owner: "", repo: "", branch: "main", folder: "reviews", token: "" };
let capMeta = null;               // {at, tiles, docH, vpW}
const attached = new Set();       // tab ids with debugger attached
const phoneTabs = new Set();

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let toastT; function toast(m, ms = 2800) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const keyFor = url => { try { const u = new URL(url); return "pm:" + u.origin + u.pathname; } catch { return null; } };
const capKey = () => "pmcap:" + key.slice(3);
function originPattern(url) { const u = new URL(url); return u.origin + "/*"; }
const ordered = () => [...(review?.notes || [])].sort((a, b) => (a.y - b.y) || (a.created - b.created));
async function send(msg) { return chrome.tabs.sendMessage(tab.id, msg); }
async function pingPage() { try { return await send({ type: "ping" }); } catch { return null; } }
async function mutate(fn) {
  const got = await store.get(key);
  const r = got[key] || { url: tab.url, title: tab.title, vp: 390, notes: [] };
  fn(r); r.updated = Date.now();
  await store.set({ [key]: r }); review = r;
}
function setUI(patch) { ui = { ...ui, ...patch }; store.set({ [UI_KEY]: ui }); renderControls(); }

/* ---------- debugger ---------- */
async function attach(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
}
const dbg = (method, params = {}) => chrome.debugger.sendCommand({ tabId: tab.id }, method, params);
chrome.debugger.onDetach.addListener((src) => { attached.delete(src.tabId); phoneTabs.delete(src.tabId); if (tab && src.tabId === tab.id) renderControls(); });

/* ---------- tab tracking ---------- */
async function refreshTab() {
  const pinned = new URLSearchParams(location.search).get("tab"); // lets the panel be opened as a tab for a given page
  const [t] = pinned ? [await chrome.tabs.get(+pinned).catch(() => null)] : await chrome.tabs.query({ active: true, currentWindow: true });
  tab = t || null; key = tab ? keyFor(tab.url) : null;
  const ok = key && /^https?:/.test(tab.url);
  $("#pageInfo").textContent = tab ? (tab.title || tab.url) : "No page";
  if (!ok) { $("#workspace").hidden = true; $("#startBlock").hidden = false; $("#startBtn").disabled = true; $("#startHint").textContent = "Open a web page (http or https) to mark it up."; return; }
  $("#startBtn").disabled = false;
  const got = await store.get([key, UI_KEY, GH_KEY, capKey() + ":meta"]);
  review = got[key] || null;
  if (got[UI_KEY]) ui = { ...ui, ...got[UI_KEY] };
  if (got[GH_KEY]) gh = { ...gh, ...got[GH_KEY] };
  capMeta = got[capKey() + ":meta"] || null;
  const live = await pingPage();
  const started = !!live || !!review;
  $("#startBlock").hidden = !!live && ui.active;
  $("#workspace").hidden = !started;
  $("#startBtn").textContent = review ? "Resume markup on this page" : "Start markup on this page";
  $("#startHint").textContent = review ? `${review.notes.length} saved note${review.notes.length === 1 ? "" : "s"} for this page.` : "Opens a markup layer on the current tab. Chrome asks once per site for permission.";
  fillFields(); renderControls(); renderList(); renderCapture();
}
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener(async (id, info, t) => {
  if (!tab || id !== tab.id) return;
  if (info.status === "complete") {
    // re-inject after reloads / phone view so the markup layer comes back
    const k = keyFor(t.url);
    const got = await store.get(k);
    if (got[k] && ui.active) {
      try { if (await chrome.permissions.contains({ origins: [originPattern(t.url)] })) await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }); } catch { }
    }
    refreshTab();
  } else if (info.url) refreshTab();
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (key && ch[key]) { review = ch[key].newValue || null; renderList(); }
  if (ch[UI_KEY]) {
    const prevSel = ui.selected, prevFocus = ui.focus;
    ui = { ...ui, ...ch[UI_KEY].newValue }; renderControls();
    if (ui.selected !== prevSel) { renderList(); scrollCard(ui.selected, ui.focus !== prevFocus); }
  }
});

/* ---------- start / stop ---------- */
$("#startBtn").addEventListener("click", async () => {
  const pattern = originPattern(tab.url);
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [pattern] }); } catch (e) { toast("Chrome blocked access to this page. Some pages, like the Chrome Web Store, can't be marked up."); return; }
  if (!granted) { toast("Permission declined, so the markup layer can't open on this site."); return; }
  try {
    if (!review) await mutate(r => { r.title = tab.title; });
    setUI({ active: true, tool: ui.tool === "browse" ? "pin" : ui.tool });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await refreshTab();
    toast("Markup is on. Click the page to add notes.");
  } catch (e) { toast("Couldn't open the markup layer here: " + (e.message || e)); }
});
$("#stopBtn").addEventListener("click", async () => { setUI({ active: false }); try { await send({ type: "deactivate" }); } catch { } $("#startBlock").hidden = false; });
let clearArmed = 0;
$("#clearBtn").addEventListener("click", async () => {
  if (Date.now() - clearArmed > 4000) { clearArmed = Date.now(); $("#clearBtn").textContent = "Click again to delete all notes"; setTimeout(() => $("#clearBtn").textContent = "Delete all notes for this page", 4000); return; }
  await mutate(r => { r.notes = []; }); await store.remove([capKey() + ":meta", capKey() + ":tiles"]); capMeta = null; renderCapture();
  $("#clearBtn").textContent = "Delete all notes for this page"; toast("All notes for this page deleted");
});

/* ---------- fields ---------- */
function fillFields() {
  if (document.activeElement?.id !== "title") $("#title").value = review?.title || tab?.title || "";
  $("#vp").value = review?.vp || 390;
  for (const k of ["owner", "repo", "branch", "folder", "token"]) $("#gh" + k[0].toUpperCase() + k.slice(1)).value = gh[k] || "";
  $("#settings").open = !gh.owner || !gh.repo || !gh.token;
}
let titleT;
$("#title").addEventListener("input", e => { clearTimeout(titleT); const v = e.target.value; titleT = setTimeout(() => mutate(r => r.title = v), 400); });
$("#vp").addEventListener("change", e => { const v = Math.max(280, Math.min(1024, +e.target.value || 390)); e.target.value = v; mutate(r => r.vp = v); if (phoneTabs.has(tab.id)) phoneOn(); });
$("#saveGh").addEventListener("click", async () => {
  gh = { owner: $("#ghOwner").value.trim(), repo: $("#ghRepo").value.trim(), branch: $("#ghBranch").value.trim() || "main", folder: $("#ghFolder").value.trim().replace(/^\/|\/$/g, "") || "reviews", token: $("#ghToken").value.trim() };
  await store.set({ [GH_KEY]: gh }); toast("GitHub settings saved in this browser");
});

/* ---------- phone view ---------- */
async function phoneOn() {
  const vp = +$("#vp").value || 390;
  await attach(tab.id);
  await dbg("Emulation.setDeviceMetricsOverride", { width: vp, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: vp, screenHeight: 844 });
  await dbg("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await dbg("Emulation.setUserAgentOverride", { userAgent: IPHONE_UA, platform: "iPhone" });
  phoneTabs.add(tab.id);
  await mutate(r => r.vp = vp);
  chrome.tabs.reload(tab.id);
}
async function phoneOff() {
  try { await chrome.debugger.detach({ tabId: tab.id }); } catch { }
  attached.delete(tab.id); phoneTabs.delete(tab.id);
  chrome.tabs.reload(tab.id);
}
$("#phoneBtn").addEventListener("click", async () => {
  try { if (phoneTabs.has(tab.id)) await phoneOff(); else await phoneOn(); renderControls(); }
  catch (e) { toast("Phone view didn't start. Close DevTools on this tab and try again. (" + (e.message || e) + ")", 5000); }
});

/* ---------- controls ---------- */
function buildControls() {
  $("#tools").innerHTML = TOOLS.map(([id, l]) => `<button type="button" class="tool" data-tool="${id}"><svg viewBox="0 0 20 20">${ICON[id]}</svg>${l}</button>`).join("");
  $("#cats").innerHTML = CATS.map(([id, l]) => `<button type="button" class="cat" data-cat="${id}" style="--c:var(--c-${id})"><i></i>${l}</button>`).join("");
  $("#stickers").innerHTML = STICKERS.map(s => `<button type="button" class="stk" data-stk="${esc(s)}">${esc(s)}</button>`).join("");
  $("#tools").onclick = e => { const b = e.target.closest(".tool"); if (b) setUI({ tool: b.dataset.tool, active: true }); };
  $("#cats").onclick = async e => {
    const b = e.target.closest(".cat"); if (!b) return;
    setUI({ cat: b.dataset.cat }); // applies to new marks; change an existing note's category from its card
  };
  $("#stickers").onclick = e => { const b = e.target.closest(".stk"); if (b) setUI({ sticker: b.dataset.stk, tool: "sticker", active: true }); };
}
function renderControls() {
  document.querySelectorAll(".tool").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === ui.tool));
  document.querySelectorAll(".cat").forEach(b => b.setAttribute("aria-pressed", b.dataset.cat === ui.cat));
  document.querySelectorAll(".stk").forEach(b => b.setAttribute("aria-pressed", b.dataset.stk === ui.sticker && ui.tool === "sticker"));
  const on = tab && phoneTabs.has(tab.id);
  $("#phoneBtn").textContent = on ? "Exit phone view" : "Phone view";
  $("#phoneBtn").classList.toggle("on", !!on);
}

/* ---------- notes list ---------- */
function renderList() {
  const list = $("#list"), items = ordered();
  const act = document.activeElement, keepId = act?.closest?.(".note")?.dataset.id, keepF = act?.dataset?.f, caret = act?.selectionStart;
  $("#count").textContent = items.length ? `${items.filter(n => !n.done).length} open` : "";
  $("#counts").innerHTML = CATS.map(([id, l]) => { const k = items.filter(n => n.cat === id && !n.done).length; return k ? `<span class="chip" style="--c:var(--c-${id})">${l} ${k}</span>` : ""; }).join("");
  if (!items.length) { list.innerHTML = `<div class="empty">No notes yet. Pick Pin and click a headline or paragraph on the page.</div>`; return; }
  list.innerHTML = items.map((n, i) => `
    <div class="note${n.id === ui.selected ? " sel" : ""}${n.done ? " done" : ""}" data-id="${n.id}" style="--c:var(--c-${n.cat})">
      <div class="num">${i + 1}</div>
      <div class="meta"><span class="k">${CAT_LABEL[n.cat]}</span><span>${n.kind === "sticker" ? "Sticker · " + esc(n.sticker) : KIND[n.kind]}</span>${n.element ? `<span>${esc(n.element)}</span>` : ""}</div>
      ${n.styles ? `<div class="spec">${esc(n.styles)}${n.spacing ? "<br>" + esc(n.spacing) : ""}</div>` : ""}
      <textarea data-f="note" aria-label="Note ${i + 1}" placeholder="What should change?">${esc(n.note)}</textarea>
      <div class="fromto"><input data-f="from" aria-label="Current value" placeholder="Current" value="${esc(n.from)}"><span>→</span><input data-f="to" aria-label="Suggested value" placeholder="Suggested" value="${esc(n.to)}"></div>
      <div class="acts">
        <select data-f="cat" aria-label="Category">${CATS.map(([id, l]) => `<option value="${id}"${id === n.cat ? " selected" : ""}>${l}</option>`).join("")}</select>
        <button class="linkbtn" data-act="show" type="button">Show</button>
        <button class="linkbtn" data-act="done" type="button">${n.done ? "Reopen" : "Resolve"}</button>
        <button class="linkbtn danger" data-act="del" type="button">Delete</button>
      </div>
    </div>`).join("");
  if (keepId && keepF) { const e = list.querySelector(`.note[data-id="${keepId}"] [data-f="${keepF}"]`); if (e) { e.focus({ preventScroll: true }); try { if (caret != null) e.setSelectionRange(caret, caret); } catch { } } }
}
function scrollCard(id, focus) {
  const c = id && document.querySelector(`.note[data-id="${id}"]`); if (!c) return;
  c.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (focus) c.querySelector("textarea")?.focus({ preventScroll: true });
}
const timers = {};
$("#list").addEventListener("input", e => {
  const f = e.target.dataset.f; if (!f || f === "cat") return;
  const id = e.target.closest(".note").dataset.id, v = e.target.value;
  const local = review.notes.find(n => n.id === id); if (local) local[f] = v;
  clearTimeout(timers[id + f]); timers[id + f] = setTimeout(() => mutate(r => { const n = r.notes.find(x => x.id === id); if (n) n[f] = v; }), 450);
});
$("#list").addEventListener("change", e => {
  if (e.target.dataset.f !== "cat") return;
  const id = e.target.closest(".note").dataset.id, v = e.target.value;
  mutate(r => { const n = r.notes.find(x => x.id === id); if (n) n.cat = v; }).then(renderList);
});
$("#list").addEventListener("focusin", e => { const c = e.target.closest(".note"); if (c && ui.selected !== c.dataset.id) { ui.selected = c.dataset.id; store.set({ [UI_KEY]: ui }); document.querySelectorAll(".note.sel").forEach(x => x.classList.remove("sel")); c.classList.add("sel"); } });
$("#list").addEventListener("click", async e => {
  const a = e.target.dataset.act; if (!a) return;
  const id = e.target.closest(".note").dataset.id;
  if (a === "show") { setUI({ selected: id }); try { await send({ type: "scrollTo", id }); } catch { toast("Start markup on this page to jump to the note."); } }
  if (a === "done") await mutate(r => { const n = r.notes.find(x => x.id === id); if (n) n.done = !n.done; });
  if (a === "del") { await mutate(r => { r.notes = r.notes.filter(x => x.id !== id); }); if (ui.selected === id) setUI({ selected: null }); }
  renderList();
});

/* ---------- capture ---------- */
function renderCapture() {
  if (!capMeta) { $("#capStatus").textContent = "Not captured yet. Capture after you've placed your notes."; $("#linkBox").hidden = !review?.publishedUrl; }
  else {
    const d = new Date(capMeta.at);
    $("#capStatus").textContent = `Captured ${d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${capMeta.vpW}px wide · ${Math.round(capMeta.docH).toLocaleString()}px tall · ${capMeta.tiles} image${capMeta.tiles === 1 ? "" : "s"}.`;
  }
  if (review?.publishedUrl) { $("#linkBox").hidden = false; $("#liveLink").href = review.publishedUrl; $("#liveLink").textContent = review.publishedUrl; }
  else $("#linkBox").hidden = true;
}
function progress(p) { const b = $("#progress"); b.hidden = p == null; if (p != null) b.firstElementChild.style.width = Math.round(p * 100) + "%"; }

async function saveCapture(tiles, info, geoms) {
  const meta = { at: Date.now(), tiles: tiles.length, docH: info.docH, docW: info.docW, vpW: info.vpW, lw: info.lw, geoms };
  await store.set({ [capKey() + ":tiles"]: tiles, [capKey() + ":meta"]: meta });
  capMeta = meta; renderCapture();
}
async function captureStitch() {
  await attach(tab.id);
  try { await dbg("Emulation.setScrollbarsHidden", { hidden: true }); } catch { }
  const info = await send({ type: "capture:prepare" });
  const tiles = [];
  try {
    let y = 0, docH = info.docH;
    for (let i = 0; i < 150; i++) {
      const r = await send({ type: "capture:scroll", y, hideFixed: i > 0 });
      docH = Math.max(docH, r.docH);
      const shot = await dbg("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      tiles.push({ src: "data:image/jpeg;base64," + shot.data, y: r.y, h: info.vpH });
      progress(Math.min(1, (r.y + info.vpH) / docH));
      if (r.y + info.vpH >= docH - 1 || (i > 0 && r.y <= tiles[i - 1].y)) break;
      y = r.y + info.vpH;
    }
    info.docH = Math.min(docH, tiles.at(-1).y + info.vpH);
  } finally { await send({ type: "capture:finish" }); try { await dbg("Emulation.setScrollbarsHidden", { hidden: false }); } catch { } }
  return { tiles, info };
}
async function captureSingle() {
  await attach(tab.id);
  try { await dbg("Emulation.setScrollbarsHidden", { hidden: true }); } catch { }
  const info = await send({ type: "capture:prepare" });
  const tiles = [];
  try {
    const CH = 3000;
    for (let y = 0; y < info.docH; y += CH) {
      const h = Math.min(CH, info.docH - y);
      const shot = await dbg("Page.captureScreenshot", { format: "jpeg", quality: 82, captureBeyondViewport: true, clip: { x: 0, y, width: info.vpW, height: h, scale: 1 } });
      tiles.push({ src: "data:image/jpeg;base64," + shot.data, y, h });
      progress((y + h) / info.docH);
    }
  } finally { await send({ type: "capture:finish" }); try { await dbg("Emulation.setScrollbarsHidden", { hidden: false }); } catch { } }
  return { tiles, info };
}
$("#captureBtn").addEventListener("click", async () => {
  const mode = $("#capMode").value;
  if (mode === "upload") { $("#fileIn").click(); return; }
  const btn = $("#captureBtn"); btn.disabled = true; btn.textContent = "Capturing… keep this tab open";
  try {
    if (!(await pingPage())) throw new Error("Start markup on this page first.");
    await send({ type: "geoms" });
    const { tiles, info } = mode === "single" ? await captureSingle() : await captureStitch();
    await saveCapture(tiles, info, info.geoms); // positions measured during capture, same layout as the images
    toast(`Captured ${tiles.length} image${tiles.length === 1 ? "" : "s"}. Ready to publish.`);
  } catch (e) {
    toast("Capture failed: " + (e.message || e) + (String(e.message || e).includes("attach") ? " Close DevTools on this tab and try again." : ""), 6000);
  } finally { btn.disabled = false; btn.textContent = "Capture page"; progress(null); }
});
$("#fileIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
  const im = new Image(); await new Promise(r => { im.onload = r; im.src = src; });
  const vpW = review?.vp || 390, h = im.naturalHeight * vpW / im.naturalWidth;
  let geoms = [], lw = vpW;
  try { const g = await send({ type: "geoms" }); geoms = g.geoms; lw = g.lw; if (Math.abs(g.vp - vpW) > 2) toast(`The page is ${g.vp}px wide but your screenshot is set to ${vpW}px. Turn on Phone view so the notes line up.`, 6000); } catch { }
  await saveCapture([{ src, y: 0, h }], { docH: h, docW: vpW, vpW, lw }, geoms);
  toast("Screenshot attached to this review");
});

/* ---------- export ---------- */
function slackList(url) {
  const items = ordered(), open = items.filter(n => !n.done), L = [];
  L.push(`*${review?.title || tab.title}*`);
  if (url) L.push(`Review with notes on the page: ${url}`);
  L.push(`Page: ${review?.url || tab.url} · mobile ${review?.vp || 390}px · ${open.length} open note${open.length === 1 ? "" : "s"}`);
  for (const [id, label] of CATS) {
    const g = items.map((n, i) => [n, i + 1]).filter(([n]) => n.cat === id && !n.done);
    if (!g.length) continue;
    L.push(""); L.push(`*${label} (${g.length})*`);
    for (const [n, num] of g) {
      const tag = n.kind === "sticker" ? `[${n.sticker}] ` : n.kind === "measure" ? `[gap ${n.from}] ` : "";
      let line = `• ${num}. ${tag}${(n.note || "(no note)").trim().replace(/\s*\n\s*/g, " ")}`;
      if (n.kind !== "measure" && (n.from || n.to)) line += ` \`${n.from || "?"} → ${n.to || "?"}\``;
      else if (n.kind === "measure" && n.to) line += ` \`→ ${n.to}\``;
      if (n.excerpt) line += ` _(“${n.excerpt.slice(0, 40)}${n.excerpt.length > 40 ? "…" : ""}”)_`;
      L.push(line);
    }
  }
  return L.join("\n");
}
async function copyText(t, msg) { try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast("Couldn't reach the clipboard. Click inside this panel and try again."); } }
$("#copySlack").addEventListener("click", () => copyText(slackList(review?.publishedUrl), "Slack list copied"));
$("#copyLink").addEventListener("click", () => copyText(review.publishedUrl, "Link copied"));

async function buildHtml() {
  if (!capMeta) throw new Error("Capture the page first.");
  const got = await store.get(capKey() + ":tiles");
  const tiles = got[capKey() + ":tiles"];
  if (!tiles?.length) throw new Error("The capture is missing. Capture the page again.");
  let geoms = capMeta.geoms || [];
  // notes added after the capture get placed from the live page, but only if its layout width still matches
  try {
    const g = await send({ type: "geoms" });
    if (g.lw === capMeta.lw) geoms = g.geoms;
  } catch { }
  const gmap = Object.fromEntries(geoms.map(g => [g.id, g.geom]));
  const items = ordered();
  const notes = items.map((n, i) => ({
    n: i + 1, id: n.id, kind: n.kind, cat: n.cat, sticker: n.sticker || null, note: n.note || "", from: n.from || "", to: n.to || "",
    element: n.element || "", styles: n.styles || "", spacing: n.spacing || "", excerpt: n.excerpt || "", done: !!n.done, geom: gmap[n.id] || null
  }));
  const missing = notes.filter(n => !n.geom).length;
  const data = {
    title: review?.title || tab.title, url: review?.url || tab.url, vp: capMeta.vpW, docH: capMeta.docH,
    capturedAt: capMeta.at, publishedAt: Date.now(), tiles, notes
  };
  const tpl = await (await fetch(chrome.runtime.getURL("viewer.html"))).text();
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const html = tpl.replace("__PM_TITLE__", esc(data.title)).replace("__PM_DATA__", () => json);
  return { html, missing };
}
function slugify(s) { return (s || "review").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "review"; }
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function ghApi(path, opts = {}) {
  const res = await fetch("https://api.github.com" + path, { ...opts, headers: { Authorization: "Bearer " + gh.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) } });
  let body = null; try { body = await res.json(); } catch { }
  return { status: res.status, body };
}
function pagesUrl(path) {
  const owner = gh.owner.toLowerCase();
  return gh.repo.toLowerCase() === owner + ".github.io" ? `https://${owner}.github.io/${path}` : `https://${owner}.github.io/${gh.repo}/${path}`;
}
$("#publishBtn").addEventListener("click", async () => {
  if (!gh.owner || !gh.repo || !gh.token) { $("#settings").open = true; toast("Add your GitHub owner, repository and access token first."); return; }
  const btn = $("#publishBtn"); btn.disabled = true; btn.textContent = "Publishing…";
  try {
    const { html, missing } = await buildHtml();
    const slug = review.slug || (slugify(review.title) + "-" + Math.random().toString(36).slice(2, 8));
    const path = `${gh.folder}/${slug}.html`;
    const repoPath = `/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/contents/${path}`;
    let sha;
    const head = await ghApi(`${repoPath}?ref=${encodeURIComponent(gh.branch)}`);
    if (head.status === 200) sha = head.body.sha;
    else if (head.status === 401) throw new Error("GitHub rejected the token. Check it hasn't expired.");
    else if (head.status === 404 && !(await ghApi(`/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}`)).body?.id) throw new Error(`Can't find ${gh.owner}/${gh.repo}, or the token can't access it.`);
    const put = await ghApi(repoPath, { method: "PUT", body: JSON.stringify({ message: `Update review: ${review.title}`, content: b64utf8(html), branch: gh.branch, ...(sha ? { sha } : {}) }) });
    if (put.status !== 200 && put.status !== 201) throw new Error(put.body?.message || "GitHub returned " + put.status);
    const url = pagesUrl(path);
    await mutate(r => { r.slug = slug; r.publishedUrl = url; r.publishedAt = Date.now(); });
    renderCapture();
    await copyText(url, missing ? `Published and link copied. ${missing} note${missing === 1 ? " was" : "s were"} added after the capture, so capture again to place ${missing === 1 ? "it" : "them"}.` : (sha ? "Updated. Same link, copied to clipboard." : "Published. Link copied to clipboard."));
  } catch (e) { toast("Publish failed: " + (e.message || e), 6000); }
  finally { btn.disabled = false; btn.textContent = "Publish to GitHub"; }
});
$("#downloadBtn").addEventListener("click", async () => {
  try {
    const { html } = await buildHtml();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = slugify(review.title) + ".html"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { toast(e.message || String(e)); }
});

buildControls();
refreshTab();
