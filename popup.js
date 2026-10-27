const $ = (id) => document.getElementById(id);

let pageInfo = null; // { title, desc, image, url }
let cover = null;    // ImageBitmap | null

// 文字颜色自适应：alpha 文字浓度，beta 反差强度，mode 自动明暗 / 保留色调
const textAdapt = { on: false, alpha: 1, beta: 1, mode: "auto" };

// 卡片配色：标题颜色、备注底色、备注底色透明度
const cardStyle = { titleColor: "#1f2329", noteBg: "#fff8dc", noteAlpha: 1 };

function setMsg(text, isError) {
  const el = $("msg");
  el.textContent = text;
  el.className = isError ? "msg error" : "msg";
}

// 在页面上下文里执行，读取当前的 meta 信息
function grabPageInfo() {
  const content = (sel) => {
    const el = document.querySelector(sel);
    return el && el.content ? el.content : "";
  };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const title = clean(content('meta[property="og:title"]')) || clean(document.title);

  let desc = "";
  for (const sel of ['meta[property="og:description"]',
                     'meta[name="description"]',
                     'meta[name="twitter:description"]']) {
    desc = clean(content(sel));
    if (desc) break;
  }

  let image = content('meta[property="og:image"]') || content('meta[name="twitter:image"]');
  if (!image) {
    const link = document.querySelector('link[rel~="icon"]');
    image = link ? link.href : "";
  }
  if (image) {
    try {
      image = new URL(image, location.href).href;
    } catch (e) {
      image = "";
    }
  }

  return { title, desc, image, url: location.href };
}

// 取封面字节再解码：直接给 img.src 跨域地址会污染 canvas，导出时 toBlob 会报错
async function loadCover(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await createImageBitmap(await resp.blob());
  } catch (e) {
    console.warn("封面加载失败：", url, e);
    return null;
  }
}

// 未取到网页封面时的兜底：用扩展内置的默认封面图
async function loadDefaultCover() {
  try {
    const resp = await fetch(chrome.runtime.getURL("default_icon.png"));
    return await createImageBitmap(await resp.blob());
  } catch (e) {
    console.warn("默认封面加载失败：", e);
    return null;
  }
}

function numInput(el, fallback) {
  const v = parseInt(el.value, 10);
  return Number.isFinite(v) ? v : fallback;
}

async function init() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    setMsg("读取标签页失败：" + e.message, true);
    return;
  }

  if (!tab || !/^https?:/.test(tab.url || "")) {
    setMsg("当前页面不支持（只支持 http/https 页面）", true);
    return;
  }

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: grabPageInfo,
    });
    pageInfo = res.result;
  } catch (e) {
    setMsg("读取页面信息失败：" + e.message, true);
    return;
  }

  $("ptitle").textContent = pageInfo.title || "（无标题）";
  $("purl").textContent = pageInfo.url;
  $("go").disabled = false;

  cover = await loadCover(pageInfo.image) || await loadDefaultCover();
  if (!cover) setMsg("未取到封面图，卡片将不显示封面");
}

const PREVIEW_MAX_H = 320; // 预览最大高度（CSS 像素），超出按比例缩小

// 卡片贴到按钮下方：按预览框宽度等比缩放，不拉伸
function showPreview(canvas, W, H) {
  const box = $("preview");
  const maxW = box.clientWidth || W;
  const s = Math.min(1, maxW / W, PREVIEW_MAX_H / H);

  canvas.style.width = Math.round(W * s) + "px";
  canvas.style.height = Math.round(H * s) + "px";

  box.replaceChildren(canvas);
}

async function generate() {
  if (!pageInfo) return;
  $("go").disabled = true;
  setMsg("生成中…");

  try {
    const W = numInput($("w"), 400);
    const H = numInput($("h"), 560);
    const canvas = drawCard({
      width: W,
      height: H,
      scale: 2,
      cardTitle: $("title").value.trim(),
      titleColor: $("titleColor").value,
      note: $("note").value.trim(),
      noteBg: $("noteBg").value,
      noteAlpha: Number($("noteAlpha").value) / 100,
      pageTitle: pageInfo.title,
      pageDesc: pageInfo.desc,
      linkUrl: pageInfo.url,
      cover,
      bgCover: $("bgToggle").classList.contains("on"),
      textAdapt: textAdapt.on
        ? { alpha: textAdapt.alpha, beta: textAdapt.beta, mode: textAdapt.mode }
        : null,
    });

    showPreview(canvas, W, H);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setMsg("已生成并复制到剪贴板，可直接粘贴");
  } catch (e) {
    setMsg("生成失败：" + e.message, true);
  } finally {
    $("go").disabled = false;
  }
}

// 「封面作背景」开关：拼在生成按钮左侧的小段按钮，状态用 chrome.storage 记住
async function setBgCover(on) {
  $("bgToggle").classList.toggle("on", on);
  $("bgToggle").title = on ? "封面作背景：开" : "封面作背景：关";
  try {
    await chrome.storage.local.set({ bgCover: on });
  } catch (e) {
    console.warn("保存开关状态失败：", e);
  }
}

$("bgToggle").addEventListener("click", (e) => {
  setBgCover(!e.currentTarget.classList.contains("on"));
});

$("go").addEventListener("click", generate);

// 卡片标题与备注折叠区：开关状态用 chrome.storage 记住
function setFold(open) {
  $("fold").classList.toggle("open", open);
  $("foldToggle").setAttribute("aria-expanded", String(open));
  $("foldBody").hidden = !open;
}

$("foldToggle").addEventListener("click", async () => {
  const open = !$("fold").classList.contains("open");
  setFold(open);
  try {
    await chrome.storage.local.set({ foldOpen: open });
  } catch (e) {
    console.warn("保存折叠状态失败：", e);
  }
});

// 卡片配色：改动后落盘，下次打开 popup 回填
function syncStyleUI() {
  $("titleColor").value = cardStyle.titleColor;
  $("noteBg").value = cardStyle.noteBg;
  $("noteAlpha").value = Math.round(cardStyle.noteAlpha * 100);
}

async function saveStyle() {
  try {
    await chrome.storage.local.set({ cardStyle });
  } catch (e) {
    console.warn("保存卡片配色失败：", e);
  }
}

async function loadStyle() {
  try {
    const saved = await chrome.storage.local.get("cardStyle");
    const s = saved.cardStyle;
    if (s && typeof s === "object") {
      if (typeof s.titleColor === "string") cardStyle.titleColor = s.titleColor;
      if (typeof s.noteBg === "string") cardStyle.noteBg = s.noteBg;
      if (Number.isFinite(s.noteAlpha)) cardStyle.noteAlpha = s.noteAlpha;
    }
  } catch (e) {
    console.warn("读取卡片配色失败：", e);
  }
  syncStyleUI();
}

$("titleColor").addEventListener("change", (e) => {
  cardStyle.titleColor = e.target.value;
  saveStyle();
});

$("noteBg").addEventListener("change", (e) => {
  cardStyle.noteBg = e.target.value;
  saveStyle();
});

// 拖动时先用输入框的值，松手（change）再落盘
$("noteAlpha").addEventListener("change", (e) => {
  cardStyle.noteAlpha = e.target.value / 100;
  saveStyle();
});

// 文字颜色自适应面板：开关 + 三个参数，设置记到 chrome.storage
function syncAdaptUI() {
  const on = textAdapt.on;
  $("adapt").classList.toggle("on", on);
  $("adaptToggle").setAttribute("aria-pressed", String(on));
  $("adaptState").textContent = on ? "开" : "关";
  $("adaptBody").hidden = !on;

  const pct = Math.round(textAdapt.alpha * 100);
  $("adaptAlpha").value = pct;
  $("adaptAlphaV").textContent = pct + "%";
  $("adaptBeta").value = textAdapt.beta;
  $("adaptBetaV").textContent = textAdapt.beta.toFixed(1);
  for (const btn of $("adaptMode").querySelectorAll("button")) {
    btn.classList.toggle("on", btn.dataset.mode === textAdapt.mode);
  }
}

async function saveAdapt() {
  try {
    await chrome.storage.local.set({ textAdapt });
  } catch (e) {
    console.warn("保存文字配色设置失败：", e);
  }
}

async function loadAdapt() {
  try {
    const saved = await chrome.storage.local.get("textAdapt");
    const s = saved.textAdapt;
    if (s && typeof s === "object") {
      if (typeof s.on === "boolean") textAdapt.on = s.on;
      if (Number.isFinite(s.alpha)) textAdapt.alpha = s.alpha;
      if (Number.isFinite(s.beta)) textAdapt.beta = s.beta;
      if (s.mode === "auto" || s.mode === "color") textAdapt.mode = s.mode;
    }
  } catch (e) {
    console.warn("读取文字配色设置失败：", e);
  }
  syncAdaptUI();
}

$("adaptToggle").addEventListener("click", () => {
  textAdapt.on = !textAdapt.on;
  syncAdaptUI();
  saveAdapt();
});

// 拖动滑杆时只更新数值，松手（change）再落盘
$("adaptAlpha").addEventListener("input", (e) => {
  textAdapt.alpha = e.target.value / 100;
  $("adaptAlphaV").textContent = e.target.value + "%";
});
$("adaptAlpha").addEventListener("change", saveAdapt);

$("adaptBeta").addEventListener("input", (e) => {
  textAdapt.beta = Number(e.target.value);
  $("adaptBetaV").textContent = textAdapt.beta.toFixed(1);
});
$("adaptBeta").addEventListener("change", saveAdapt);

$("adaptMode").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  textAdapt.mode = btn.dataset.mode;
  syncAdaptUI();
  saveAdapt();
});

// 恢复上次的开关状态；没存过时默认开
(async () => {
  let on = true;
  try {
    const saved = await chrome.storage.local.get("bgCover");
    if (typeof saved.bgCover === "boolean") on = saved.bgCover;
  } catch (e) {
    console.warn("读取开关状态失败：", e);
  }
  setBgCover(on);
})();

// 恢复折叠状态；没存过时默认展开
(async () => {
  let open = true;
  try {
    const saved = await chrome.storage.local.get("foldOpen");
    if (typeof saved.foldOpen === "boolean") open = saved.foldOpen;
  } catch (e) {
    console.warn("读取折叠状态失败：", e);
  }
  setFold(open);
})();

loadStyle();
loadAdapt();
init();
