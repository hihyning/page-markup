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
let gh = { owner: "hihyning", repo: "page-markup", branch: "main", folder: "reviews", token: "" };
let capMetas = {};                // per view: {at, tiles, docH, vpW, lw, geoms}
let live = null;                  // what the tab reports: {lw, view}
let listView = "current";         // notes list filter: current | all | mobile | desktop
const VIEWS = [["mobile", "Mobile"], ["desktop", "Desktop"]];
const VIEW_LABEL = Object.fromEntries(VIEWS);
const viewOf = n => n.view || "mobile";
const attached = new Set();       // tab ids with debugger attached
const phoneTabs = new Set();

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let toastT; function toast(m, ms = 2800) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const keyFor = url => { try { const u = new URL(url); return "pm:" + u.origin + u.pathname; } catch { return null; } };
const capKey = view => "pmcap:" + key.slice(3) + ":" + view;
function originPattern(url) { const u = new URL(url); return u.origin + "/*"; }
const ordered = view => [...(review?.notes || [])].filter(n => !view || viewOf(n) === view).sort((a, b) => (a.y - b.y) || (a.created - b.created));
// numbers restart for each view, matching the marks drawn on that view
function numbering() { const m = {}; for (const [v] of VIEWS) ordered(v).forEach((n, i) => m[n.id] = i + 1); return m; }
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
  const got = await store.get([key, UI_KEY, GH_KEY, capKey("mobile") + ":meta", capKey("desktop") + ":meta"]);
  review = got[key] || null;
  if (got[UI_KEY]) ui = { ...ui, ...got[UI_KEY] };
  if (got[GH_KEY]) gh = { ...gh, ...got[GH_KEY] };
  capMetas = { mobile: got[capKey("mobile") + ":meta"] || null, desktop: got[capKey("desktop") + ":meta"] || null };
  live = await pingPage();
  const started = !!live || !!review;
  $("#startBlock").hidden = !!live && ui.active;
  $("#workspace").hidden = !started;
  $("#startBtn").textContent = review ? "Resume markup on this page" : "Start markup on this page";
  $("#startHint").textContent = review ? `${review.notes.length} saved note${review.notes.length === 1 ? "" : "s"} for this page.` : "Opens a markup layer on the current tab. Chrome asks once per site for permission.";
  fillFields(); renderControls(); renderView(); renderList(); renderCapture();
}
function renderView() {
  const el = $("#viewInfo");
  if (!live) { el.textContent = ""; return; }
  el.innerHTML = `This tab is <b>${live.lw}px</b> wide, so new notes go to <b>${VIEW_LABEL[live.view]}</b>. ${live.view === "mobile" ? "Exit phone view (or DevTools device mode) for Desktop." : "Use Phone view or DevTools device mode for Mobile."}`;
}
// notice when the tab changes width (DevTools device mode, window resize)
setInterval(async () => {
  if (document.hidden || !tab || $("#workspace").hidden) return;
  const p = await pingPage();
  if (p && (!live || p.lw !== live.lw)) { live = p; renderView(); renderList(); renderCapture(); }
}, 1500);
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
  await mutate(r => { r.notes = []; }); await store.remove(VIEWS.flatMap(([v]) => [capKey(v) + ":meta", capKey(v) + ":tiles"])); capMetas = {}; renderCapture();
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
  const list = $("#list"), cur = live?.view || "mobile", fv = listView === "current" ? cur : listView;
  const items = fv === "all" ? [...ordered("mobile"), ...ordered("desktop")] : ordered(fv), nums = numbering();
  $("#viewTabs").innerHTML = [["current", `This view (${VIEW_LABEL[cur]})`], ["all", "All"], ...VIEWS.filter(([v]) => v !== cur).map(([v, l]) => [v, l])]
    .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === listView}">${l} <span>${v === "all" ? (review?.notes.length || 0) : ordered(v === "current" ? cur : v).length}</span></button>`).join("");
  const act = document.activeElement, keepId = act?.closest?.(".note")?.dataset.id, keepF = act?.dataset?.f, caret = act?.selectionStart;
  $("#count").textContent = items.length ? `${items.filter(n => !n.done).length} open` : "";
  $("#counts").innerHTML = CATS.map(([id, l]) => { const k = items.filter(n => n.cat === id && !n.done).length; return k ? `<span class="chip" style="--c:var(--c-${id})">${l} ${k}</span>` : ""; }).join("");
  if (!items.length) { list.innerHTML = `<div class="empty">${review?.notes.length ? `No ${fv === "all" ? "" : VIEW_LABEL[fv] + " "}notes yet.` : "No notes yet. Pick Pin and click a headline or paragraph on the page."}</div>`; return; }
  list.innerHTML = items.map(n => `
    <div class="note${n.id === ui.selected ? " sel" : ""}${n.done ? " done" : ""}" data-id="${n.id}" style="--c:var(--c-${n.cat})">
      <div class="num">${nums[n.id]}</div>
      <div class="meta"><span class="vw">${VIEW_LABEL[viewOf(n)]}</span><span class="k">${CAT_LABEL[n.cat]}</span><span>${n.kind === "sticker" ? "Sticker · " + esc(n.sticker) : KIND[n.kind]}</span>${n.element ? `<span>${esc(n.element)}</span>` : ""}</div>
      ${n.styles ? `<div class="spec">${esc(n.styles)}${n.spacing ? "<br>" + esc(n.spacing) : ""}</div>` : ""}
      <textarea data-f="note" aria-label="${VIEW_LABEL[viewOf(n)]} note ${nums[n.id]}" placeholder="What should change?">${esc(n.note)}</textarea>
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
  const note = review.notes.find(x => x.id === id);
  if (a === "show" && live && note && viewOf(note) !== live.view) { toast(`This note is on the ${VIEW_LABEL[viewOf(note)]} view. Switch the tab to ${viewOf(note) === "mobile" ? "phone width" : "desktop width"} to see it.`, 4500); return; }
  if (a === "show") { setUI({ selected: id }); try { await send({ type: "scrollTo", id }); } catch { toast("Start markup on this page to jump to the note."); } }
  if (a === "done") await mutate(r => { const n = r.notes.find(x => x.id === id); if (n) n.done = !n.done; });
  if (a === "del") { await mutate(r => { r.notes = r.notes.filter(x => x.id !== id); }); if (ui.selected === id) setUI({ selected: null }); }
  renderList();
});

/* ---------- capture ---------- */
function renderCapture() {
  const cur = live?.view;
  $("#capStatus").innerHTML = VIEWS.map(([v, l]) => {
    const m = capMetas[v], k = ordered(v).length;
    const st = m ? `captured ${new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} at ${m.vpW}px` : (k ? "not captured yet" : "no notes");
    return `<span class="capline${m ? " ok" : k ? " todo" : ""}"><b>${l}</b> · ${k} note${k === 1 ? "" : "s"} · ${st}</span>`;
  }).join("");
  $("#captureBtn").textContent = cur ? `Capture ${VIEW_LABEL[cur]} view` : "Capture page";
  if (review?.publishedUrl) { $("#linkBox").hidden = false; $("#liveLink").href = review.publishedUrl; $("#liveLink").textContent = review.publishedUrl; }
  else $("#linkBox").hidden = true;
}
function progress(p) { const b = $("#progress"); b.hidden = p == null; if (p != null) b.firstElementChild.style.width = Math.round(p * 100) + "%"; }

async function saveCapture(view, tiles, info, geoms) {
  const meta = { at: Date.now(), tiles: tiles.length, docH: info.docH, docW: info.docW, vpW: info.vpW, lw: info.lw, view, geoms };
  await store.set({ [capKey(view) + ":tiles"]: tiles, [capKey(view) + ":meta"]: meta });
  capMetas[view] = meta; renderCapture();
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
    await saveCapture(info.view, tiles, info, info.geoms); // positions measured during capture, same layout as the images
    const other = info.view === "mobile" ? "desktop" : "mobile";
    toast(`${VIEW_LABEL[info.view]} view captured.${ordered(other).length && !capMetas[other] ? ` Capture the ${VIEW_LABEL[other]} view too before publishing.` : " Ready to publish."}`, 4000);
  } catch (e) {
    toast("Capture failed: " + (e.message || e) + (String(e.message || e).includes("attach") ? " Close DevTools on this tab and try again." : ""), 6000);
  } finally { btn.disabled = false; progress(null); renderCapture(); }
});
$("#fileIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
  const im = new Image(); await new Promise(r => { im.onload = r; im.src = src; });
  let geoms = [], lw = live?.lw || 390, view = live?.view || "mobile";
  try { const g = await send({ type: "geoms" }); geoms = g.geoms; lw = g.lw; view = g.view; } catch { }
  const h = im.naturalHeight * lw / im.naturalWidth;
  await saveCapture(view, [{ src, y: 0, h }], { docH: h, docW: lw, vpW: lw, lw }, geoms);
  toast(`Screenshot attached to the ${VIEW_LABEL[view]} view. It should be ${lw}px wide in CSS pixels (any device scale) so the notes line up.`, 5000);
});

/* ---------- export ---------- */
function slackList(url) {
  const nums = numbering(), open = (review?.notes || []).filter(n => !n.done), L = [];
  L.push(`*${review?.title || tab.title}*`);
  if (url) L.push(`Review with notes on the page: ${url}`);
  L.push(`Page: ${review?.url || tab.url} · ${open.length} open note${open.length === 1 ? "" : "s"}`);
  for (const [v, vl] of VIEWS) {
   const items = ordered(v).filter(n => !n.done);
   if (!items.length) continue;
   const w = capMetas[v]?.vpW || items[0].lw;
   L.push(""); L.push(`*— ${vl}${w ? ` (${w}px)` : ""} —*`);
   for (const [id, label] of CATS) {
    const g = items.map(n => [n, nums[n.id]]).filter(([n]) => n.cat === id);
    if (!g.length) continue;
    L.push(`_${label} (${g.length})_`);
    for (const [n, num] of g) {
      const tag = n.kind === "sticker" ? `[${n.sticker}] ` : n.kind === "measure" ? `[gap ${n.from}] ` : "";
      let line = `• ${num}. ${tag}${(n.note || "(no note)").trim().replace(/\s*\n\s*/g, " ")}`;
      if (n.kind !== "measure" && (n.from || n.to)) line += ` \`${n.from || "?"} → ${n.to || "?"}\``;
      else if (n.kind === "measure" && n.to) line += ` \`→ ${n.to}\``;
      if (n.excerpt) line += ` _(“${n.excerpt.slice(0, 40)}${n.excerpt.length > 40 ? "…" : ""}”)_`;
      L.push(line);
    }
   }
  }
  return L.join("\n");
}
async function copyText(t, msg) { try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast("Couldn't reach the clipboard. Click inside this panel and try again."); } }
$("#copySlack").addEventListener("click", () => copyText(slackList(review?.publishedUrl), "Slack list copied"));
$("#copyLink").addEventListener("click", () => copyText(review.publishedUrl, "Link copied"));

async function buildHtml() {
  const views = {}, gmap = {};
  for (const [v] of VIEWS) {
    const meta = capMetas[v]; if (!meta) continue;
    const got = await store.get(capKey(v) + ":tiles");
    const tiles = got[capKey(v) + ":tiles"]; if (!tiles?.length) continue;
    let geoms = meta.geoms || [];
    // notes added after the capture get placed from the live page, but only if its layout width still matches
    try { const g = await send({ type: "geoms" }); if (g.view === v && g.lw === meta.lw) geoms = g.geoms; } catch { }
    for (const g of geoms) gmap[g.id] = g.geom;
    views[v] = { vp: meta.vpW, docH: meta.docH, capturedAt: meta.at, tiles };
  }
  if (!Object.keys(views).length) throw new Error("Capture the page first.");
  const nums = numbering();
  const notes = [...ordered("mobile"), ...ordered("desktop")].filter(n => views[viewOf(n)]).map(n => ({
    n: nums[n.id], id: n.id, view: viewOf(n), kind: n.kind, cat: n.cat, sticker: n.sticker || null, note: n.note || "", from: n.from || "", to: n.to || "",
    element: n.element || "", styles: n.styles || "", spacing: n.spacing || "", excerpt: n.excerpt || "", done: !!n.done, geom: gmap[n.id] || null
  }));
  const uncaptured = (review?.notes || []).filter(n => !views[viewOf(n)]).length;
  const missing = notes.filter(n => !n.geom).length + uncaptured;
  const data = { title: review?.title || tab.title, url: review?.url || tab.url, publishedAt: Date.now(), views, notes };
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
    await copyText(url, missing ? `Published and link copied. ${missing} note${missing === 1 ? " was" : "s were"} missing from the review: they were added after the last capture or their view isn't captured. Capture again to include ${missing === 1 ? "it" : "them"}.` : (sha ? "Updated. Same link, copied to clipboard." : "Published. Link copied to clipboard."));
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

$("#viewTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { listView = b.dataset.v; renderList(); } });
buildControls();
refreshTab();
