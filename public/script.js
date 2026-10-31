const $ = (id) => document.getElementById(id);
const input = $("radiograph-upload");
const SAMPLES = { normal: "samples/normal.jpg", cardiomegaly: "samples/cardiomegaly.jpg" };

// three CTR levels, same as the "About CTR" cards
const TONE = {
  ok: { short: "Normal", label: "Normal (CTR ≤ 0.50)", badge: "bg-emerald-100 text-emerald-800 border-emerald-300", hero: "bg-emerald-950/80 border-emerald-500/40 text-emerald-400", num: "text-emerald-400", note: "is within the normal range (≤ 0.50)" },
  border: { short: "Borderline", label: "Borderline (CTR 0.51 – 0.55)", badge: "bg-amber-100 text-amber-900 border-amber-300", hero: "bg-amber-950/80 border-amber-500/40 text-amber-400", num: "text-amber-400", note: "is borderline (0.51 – 0.55)" },
  high: { short: "Suspected", label: "Suspected Cardiomegaly (CTR > 0.55)", badge: "bg-rose-100 text-rose-900 border-rose-300", hero: "bg-rose-950/80 border-rose-500/40 text-rose-400", num: "text-rose-400", note: "is above 0.55 and may indicate an enlarged heart" },
};
const level = (ctr) => (ctr <= 0.5 ? TONE.ok : ctr <= 0.55 ? TONE.border : TONE.high);

const BADGE = "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono border font-medium ";
const MINI = "px-2 py-0.5 rounded text-[11px] font-mono border ";
const HERO_BADGE = "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono border ";
const HERO_NUM = "font-bold text-base ";
const CARD = "flex items-start gap-3 p-3 rounded border cursor-pointer transition-all ";
const CARD_ON = CARD + "border-primary bg-primary/5";
const CARD_OFF = CARD + "border-outline-variant hover:border-outline";

let busy = false;

const setNotice = (text) => ($("notice-text").textContent = text);

function setBusy(on) {
  busy = on;
  input.disabled = on;
  document.querySelectorAll('input[name="sample_selection"]').forEach((r) => (r.disabled = on));
  document.body.classList.toggle("cursor-wait", on);
  $("notice-text").classList.toggle("animate-pulse", on);
  $("preview-xray").classList.toggle("opacity-50", on);
}

// each layer is its own transparent picture on top of the plain X-ray
function setLayer(id, src) {
  const img = new Image();
  img.src = src;
  img.alt = "";
  img.className = "w-full h-full object-cover";
  $(id).replaceChildren(img);
}

function toggleLayer(name) {
  const hidden = $(`layer-${name}`).classList.toggle("hidden");
  const on = !hidden;
  const btn = $(`toggle-${name}-mask`);
  ["bg-primary", "text-on-primary", "border-primary"].forEach((c) => btn.classList.toggle(c, on));
  ["bg-surface-container-high", "text-on-surface", "border-outline-variant"].forEach((c) => btn.classList.toggle(c, !on));
}

async function predict(blob, name) {
  const form = new FormData();
  form.append("image", blob, name);
  const t0 = performance.now();
  const res = await fetch("/predict", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed. The file may be too large (max 10 MB).");
  data.seconds = (performance.now() - t0) / 1000;
  return data;
}

function showResult(data, blob, name) {
  if (!data.base || !data.heart_layer || !data.lines_layer) {
    return setNotice("The server is still running the old heart_model.py. Replace it with the new one and restart python app.py.");
  }
  const t = level(data.ctr);
  $("preview-xray").src = data.base;
  setLayer("layer-heart", data.heart_layer);
  setLayer("layer-thorax", data.lines_layer);

  $("val-cardiac").textContent = `${data.heart_width} px`;
  $("val-thorax").textContent = `${data.chest_width} px`;
  $("val-ctr").textContent = data.ctr.toFixed(2);
  $("badge-ctr-status").className = BADGE + t.badge;
  $("badge-ctr-status").textContent = t.label;
  $("active-study-id").textContent = "STUDY: " + name.toUpperCase();
  $("study-meta").textContent = "| View: " + data.view + (data.view === "AP" ? " (may overestimate)" : "");
  $("latency").textContent = `${data.seconds.toFixed(1)} s (CPU)`;

  setNotice(
    `Calculated CTR of ${data.ctr.toFixed(2)} ${t.note} on this ${data.view} X-ray.` +
    (data.view === "AP" ? " AP views can make the heart look larger than it is." : "") +
    " This is an educational estimate, not a diagnosis."
  );
}

function fillSampleBadge(id, data) {
  $(id).className = MINI + level(data.ctr).badge;
  $(id).textContent = `CTR ${data.ctr.toFixed(2)}`;
}

function fillHero(data) {
  const t = level(data.ctr);
  $("hero-xray").src = data.image;
  $("hero-badge").className = HERO_BADGE + t.hero;
  $("hero-badge").textContent = `CTR: ${data.ctr.toFixed(2)} (${t.short})`;
  $("hero-ctr").className = HERO_NUM + t.num;
  $("hero-ctr").textContent = data.ctr.toFixed(2);
  $("hero-widths").textContent = `Heart: ${data.heart_width}px / Chest: ${data.chest_width}px`;
}

async function loadSample(type) {
  const url = SAMPLES[type];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sample image not found: public/${url}`);
  return { blob: await res.blob(), name: url.split("/").pop() };
}

async function run(getInput, after) {
  if (busy) return;
  setBusy(true);
  setNotice("Analyzing X-ray...");
  try {
    const { blob, name } = await getInput();
    const data = await predict(blob, name);
    showResult(data, blob, name);
    if (after) after(data);
  } catch (e) {
    setNotice(e instanceof TypeError ? "Could not reach the server. Is it running?" : e.message);
  } finally {
    setBusy(false);
  }
}

function switchSample(type) {
  if (busy) return;
  $("sample-btn-1").className = type === "normal" ? CARD_ON : CARD_OFF;
  $("sample-btn-2").className = type === "normal" ? CARD_OFF : CARD_ON;
  const badge = type === "normal" ? "sample1-ctr" : "sample2-ctr";
  run(() => loadSample(type), (d) => fillSampleBadge(badge, d));
}

function pick(file) {
  if (busy) return;
  document.querySelectorAll('input[name="sample_selection"]').forEach((r) => (r.checked = false));
  $("sample-btn-1").className = CARD_OFF;
  $("sample-btn-2").className = CARD_OFF;
  run(async () => ({ blob: file, name: file.name }));
}

input.addEventListener("change", () => {
  if (input.files[0]) pick(input.files[0]);
  input.value = "";
});

const dropzone = document.querySelector('label[for="radiograph-upload"]').parentElement;
dropzone.addEventListener("dragover", (e) => e.preventDefault());
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
});

// on page load: analyze sample 1 (fills the result, hero and its badge),
// then sample 2 in the background so its badge shows a real value too
async function init() {
  await run(() => loadSample("normal"), (d) => {
    fillSampleBadge("sample1-ctr", d);
    fillHero(d);
  });
  try {
    const { blob, name } = await loadSample("cardiomegaly");
    fillSampleBadge("sample2-ctr", await predict(blob, name));
  } catch (e) { /* sample 2 missing: leave its badge as "CTR --" */ }
}
init();