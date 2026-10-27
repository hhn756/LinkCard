// ========== 卡片绘制 ==========

const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

const COLOR_BG         = "#ffffff";
const COLOR_TITLE      = "#1f2329";
const COLOR_NOTE_BG    = "#fff8dc";
const COLOR_NOTE_TEXT  = "#6b5a22";
const COLOR_PAGE_TITLE       = "#fdfefe"; // 有封面时：页面标题
const COLOR_PAGE_DESC        = "#d5dbdb"; // 有封面时：页面描述
const COLOR_URL_COVER        = "#a1c0dc"; // 有封面时：底部链接文字
const COLOR_PAGE_TITLE_PLAIN = "#8b9098"; // 无封面白底时：页面标题 / 链接文字
const COLOR_PAGE_DESC_PLAIN  = "#b9bec6"; // 无封面白底时：页面描述
const COLOR_INFO_BG    = "rgba(240, 242, 245, 0.05)";
const COLOR_QR_BG      = "rgba(255, 255, 255, 0.85)"; // 半透明白：够亮保证对比，又不会硬切一块

// ---------- 文本色自适应 ----------
// 采样文字下方背景 B，把目标色 F 外推成填充色 T；α 为文字整体不透明度，参与最终合成
// mode = "auto"：按背景亮度取黑或白，T = gray(L + β(target − L))
// mode = "color"：保留色调，把 F 推离 B，T = F + β(F − B)；对比度不够时退回自动明暗
const ADAPT_MIN_CR = 4.5; // 保留色调模式的最低对比度（WCAG），不够就兜底
const clamp01   = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const luminance = (c) => 0.2126 * srgbToLin(c[0]) + 0.7152 * srgbToLin(c[1]) + 0.0722 * srgbToLin(c[2]);

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbCss(c) {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}

// 取一块区域的平均背景色（0..1 sRGB）；坐标按逻辑像素，内部换算成设备像素
function sampleBackground(ctx, x, y, w, h, scale) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const sx = Math.max(0, Math.min(cw - 1, Math.round(x * scale)));
  const sy = Math.max(0, Math.min(ch - 1, Math.round(y * scale)));
  const sw = Math.max(1, Math.min(cw - sx, Math.round(w * scale)));
  const sh = Math.max(1, Math.min(ch - sy, Math.round(h * scale)));
  const data = ctx.getImageData(sx, sy, sw, sh).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = (data.length / 4) * 255;
  return [r / n, g / n, b / n];
}

function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// 自动明暗：按背景亮度取黑或白，β 控制向目标压的力度
function autoTextColor(bg, beta) {
  const L = luminance(bg);
  const target = L >= 0.5 ? 0 : 1;
  const v = linToSrgb(clamp01(L + beta * (target - L)));
  return [v, v, v];
}

// 由目标色 F 和背景 B 推算文字填充色（0..1 sRGB）
function adaptTextColor(fg, bg, mode, beta) {
  if (mode === "auto") return autoTextColor(bg, beta);

  const t = fg.map((c, i) => clamp01(c + beta * (c - bg[i])));
  if (contrastRatio(t, bg) >= ADAPT_MIN_CR) return t;
  return autoTextColor(bg, 1); // 兜底：直接压到黑白
}

function setFont(ctx, size) {
  ctx.font = `${size}px ${FONT_STACK}`;
}

function textWidth(ctx, text, size) {
  setFont(ctx, size);
  return ctx.measureText(text).width;
}

// 按像素宽度换行；中文可任意断行，英文尽量按空格断词
function wrapText(ctx, text, size, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const ch of paragraph) {
      if (!cur || textWidth(ctx, cur + ch, size) <= maxWidth) {
        cur += ch;
        continue;
      }
      // 英文单词尽量不断开
      if (/[0-9A-Za-z]/.test(ch) && /[0-9A-Za-z]$/.test(cur)) {
        const sp = cur.lastIndexOf(" ");
        if (sp > 0) {
          lines.push(cur.slice(0, sp));
          cur = cur.slice(sp + 1) + ch;
          continue;
        }
      }
      lines.push(cur);
      cur = ch;
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

// 单行截断，超出部分用省略号
function ellipsize(ctx, text, size, maxWidth) {
  if (textWidth(ctx, text, size) <= maxWidth) return text;
  const ellW = textWidth(ctx, "…", size);
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(ctx, text.slice(0, mid), size) + ellW <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  // 二分可能切在代理对中间，去掉落单的半个字符
  return text.slice(0, lo).replace(/[\uD800-\uDFFF]$/, "") + "…";
}

// 生成二维码模块矩阵；qrcode.js 未加载或数据异常时返回 null
function makeQrMatrix(data) {
  if (!data || typeof qrcode !== "function") return null;
  try {
    const qr = qrcode(0, "M"); // 0 = 自动选版本，M 级纠错（样式化绘制后多留点容错）
    qr.addData(data);
    qr.make();
    return { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
  } catch (e) {
    return null;
  }
}

// 特例：B 站视频页的链接缩短成 b23.tv 短链（BV 号区分大小写，原样保留）
function shortenUrl(url) {
  const m = /^https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]+)/i.exec(url || "");
  return m ? `https://b23.tv/${m[1]}` : url;
}

/**
 * 画一张分享卡片，返回离屏 canvas
 * @param {object} o
 * @param {number} o.width     卡片逻辑宽度
 * @param {number} o.height    卡片逻辑高度
 * @param {number} o.scale     像素倍率（输出尺寸 = 逻辑尺寸 × scale）
 * @param {string} o.cardTitle 顶部标题，空则不画
 * @param {string} [o.titleColor="#1f2329"] 顶部标题颜色
 * @param {string} o.note      备注，非空时中部画备注框
 * @param {string} [o.noteBg="#fff8dc"] 备注框底色
 * @param {number} [o.noteAlpha=1] 备注框底色不透明度 0..1
 * @param {string} o.pageTitle 页面标题
 * @param {string} o.pageDesc  页面描述
 * @param {string} o.linkUrl   完整链接，画在底部并生成二维码（B 站视频会缩短为 b23.tv）
 * @param {ImageBitmap|null} o.cover 封面图
 * @param {boolean} [o.bgCover=true] 封面作背景（模糊铺底+毛玻璃面板）；关闭后白底配色，封面仅作中部大图/缩略图
 * @param {{alpha:number, beta:number, mode:"auto"|"color"}|null} [o.textAdapt] 底部信息区文字色自适应；不传则用固定配色
 */
function drawCard(o) {
  const W = o.width;
  const H = o.height;
  const scale = o.scale || 1;
  const cardTitle = o.cardTitle || "";
  const titleColor = o.titleColor || COLOR_TITLE;
  const note = o.note || "";
  const noteBg = o.noteBg || COLOR_NOTE_BG;
  const noteAlpha = Number.isFinite(o.noteAlpha) ? o.noteAlpha : 1;
  const pageTitle = o.pageTitle || "";
  const pageDesc = o.pageDesc || "";
  const linkUrl = shortenUrl(o.linkUrl);
  const cover = o.cover || null;
  const bgOn = o.bgCover !== false;
  const textAdapt = o.textAdapt || null; // 底部文字色自适应设置，null 表示用固定配色

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "top";

  const paint = (x, y, text, size, color) => {
    setFont(ctx, size);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  // 采样文字所在处的背景，按设置推算填充色和透明度后再画
  const paintAdaptive = (x, y, text, size, fgHex) => {
    const bg = sampleBackground(ctx, x, y, textWidth(ctx, text, size), size, scale);
    const color = adaptTextColor(hexToRgb01(fgHex), bg, textAdapt.mode, textAdapt.beta);
    ctx.save();
    ctx.globalAlpha = textAdapt.alpha;
    paint(x, y, text, size, rgbCss(color));
    ctx.restore();
  };
  // 未启用自适应时直接用调色板颜色
  const paintFooter = textAdapt ? paintAdaptive : paint;
  const roundBox = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, W, H);

  // ---------- 相对尺寸（全部基于卡片宽度 W） ----------
  const pad_top        = W * 0.075;
  const title_size     = Math.max(12, Math.round(W * 0.065));
  const title_lh_mul   = 1.32;
  const gap_title_note = W * 0.055;

  const note_mx        = W * 0.10;
  const note_px        = W * 0.045;
  const note_py        = W * 0.040;
  const note_size      = Math.max(10, Math.round(W * 0.038));
  const note_lh_mul    = 1.70;
  const note_radius    = W * 0.025;

  const footer_w       = W * 0.90;
  const footer_h       = W * 0.14;
  const footer_bm      = W * 0.055;
  const footer_gap_top = W * 0.05;

  const page_title_size = Math.max(9, Math.round(W * 0.035));
  const page_desc_size  = Math.max(8, Math.round(W * 0.030));

  // 链接条（排在底部信息条下方）：左侧完整链接，右侧二维码
  const qr_size   = Math.round(W * 0.24);
  const qr_gap    = W * 0.035;
  const url_size  = Math.max(7, Math.round(W * 0.026));
  const url_lh_mul = 1.55;
  const link_gap  = W * 0.035;

  // ---------- 底部布局：自下而上排布 链接条 → 信息条（先算坐标，背景要用） ----------
  // 信息区整体靠左（面板贴卡片左缘），右侧留一段淡出留白
  const infoLeft  = W * 0.05; // 内容左缘
  const infoRight = W * 0.64; // 内容右界，再往右是留白淡出区

  const qr = makeQrMatrix(linkUrl);
  const qrCell = qr ? Math.max(2, Math.floor(qr_size / qr.count)) : 0;
  const qrSide = qr ? qr.count * qrCell : 0;
  const qrPad   = qr ? qrCell * 2 : 0; // 静区：码周围至少留 2 个模块的亮边
  const qrBlock = qrSide + qrPad * 2;  // 含白底的整体尺寸

  // 二维码在左，链接排其右侧
  const urlX = qr ? infoLeft + qrBlock + qr_gap : infoLeft;
  const urlLineH = url_size * url_lh_mul;
  const urlLines = linkUrl ? wrapText(ctx, linkUrl, url_size, infoRight - urlX) : [];
  const urlH = urlLines.length * urlLineH;

  const linkBottom = H - footer_bm;
  const linkH = Math.max(urlH, qrBlock);
  const linkTop = linkBottom - linkH;

  const footerY = linkTop - link_gap - footer_h;

  // ---------- 背景：有封面且开启 bgCover 时铺放大模糊封面，底部垫左贴边、右淡出的毛玻璃 ----------
  if (cover && bgOn) {
    const blurBg    = W * 0.03; // 全卡背景的模糊度
    const blurPanel = W * 0.08; // 毛玻璃：面板背后的内容比背景再糊一档
    const m = blurPanel * 2;    // 图四边外扩，避免模糊边缘在卡片边界发白（按更大的模糊量算）
    const s = Math.max((W + 2 * m) / cover.width, (H + 2 * m) / cover.height);
    const iw = cover.width * s;
    const ih = cover.height * s;
    const ix = (W - iw) / 2;
    const iy = (H - ih) / 2;

    ctx.save();
    // filter 的模糊半径不受变换矩阵影响，按设备像素给出
    ctx.filter = `blur(${Math.round(blurBg * scale)}px)`;
    ctx.drawImage(cover, ix, iy, iw, ih);
    ctx.restore();

    // 毛玻璃面板：在离屏画布合成（更糊的背景 + 淡灰罩层），右缘整体淡出到透明
    const p  = W * 0.03;
    const px = 0;               // 左缘紧贴卡片边
    const py = footerY - p;
    const pw = W * 0.95;
    const ph = linkBottom - footerY + 2 * p;

    const glass = document.createElement("canvas");
    glass.width  = Math.max(1, Math.round(pw * scale));
    glass.height = Math.max(1, Math.round(ph * scale));
    const g = glass.getContext("2d");
    g.scale(scale, scale);

    // 面板背后的封面重画得更糊（封面矩形远大于面板，模糊不会在画布边缘露透明）
    g.filter = `blur(${Math.round(blurPanel * scale)}px)`;
    g.drawImage(cover, ix - px, iy - py, iw, ih);
    g.filter = "none";

    // 淡灰罩层
    g.fillStyle = COLOR_INFO_BG;
    g.fillRect(0, 0, pw, ph);

    // 右侧透明度递减：糊背景和罩层一起淡出
    g.globalCompositeOperation = "destination-in";
    const fade = g.createLinearGradient(0, 0, pw, 0);
    fade.addColorStop(0.70, "rgba(0, 0, 0, 1)");
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = fade;
    g.fillRect(0, 0, pw, ph);

    ctx.drawImage(glass, px, py, pw, ph);
  }

  // ---------- 顶部居中大字标题 ----------
  let y = pad_top;
  if (cardTitle) {
    const titleLineH = title_size * title_lh_mul;
    for (const line of wrapText(ctx, cardTitle, title_size, W - 2 * pad_top)) {
      paint((W - textWidth(ctx, line, title_size)) / 2, y, line, title_size, titleColor);
      y += titleLineH;
    }
    y += gap_title_note;
  }

  // ---------- 中部 ----------
  const midTop = y;
  const midH = footerY - footer_gap_top - midTop;

  if (note && midH > 0) {
    const noteTextW = W - 2 * note_mx - 2 * note_px;
    const noteLineH = note_size * note_lh_mul;
    let noteLines = wrapText(ctx, note, note_size, noteTextW);

    // 按可用高度截断
    const maxLines = Math.floor((midH - 2 * note_py) / noteLineH);
    if (maxLines < 1) {
      noteLines = [];
    } else if (noteLines.length > maxLines) {
      noteLines = noteLines.slice(0, maxLines);
      let last = noteLines[maxLines - 1];
      while (last && textWidth(ctx, last + "…", note_size) > noteTextW) last = last.slice(0, -1);
      noteLines[maxLines - 1] = last + "…";
    }

    if (noteLines.length) {
      const boxH = noteLines.length * noteLineH + 2 * note_py;
      ctx.save();
      ctx.globalAlpha = noteAlpha;
      ctx.fillStyle = noteBg;
      roundBox(note_mx, midTop, W - 2 * note_mx, boxH, note_radius);
      ctx.fill();
      ctx.restore();

      let ty = midTop + note_py;
      for (const line of noteLines) {
        paint(note_mx + note_px, ty, line, note_size, COLOR_NOTE_TEXT);
        ty += noteLineH;
      }
    }
  } else if (cover && midH > 0) {
    // 无备注：中部等比展示封面大图（完整显示，不裁切）
    const s = Math.min(footer_w / cover.width, midH / cover.height);
    const iw = cover.width * s;
    const ih = cover.height * s;
    const ix = (W - iw) / 2;
    const iy = midTop + (midH - ih) / 2;
    ctx.save();
    roundBox(ix, iy, iw, ih, W * 0.03);
    ctx.clip();
    ctx.drawImage(cover, ix, iy, iw, ih);
    ctx.restore();
  }

  // ---------- 底部信息条：页面标题 / 描述（有备注时封面缩略图在文字左侧） ----------
  // 封面只在中部大图（无备注）与这里二选一，避免同一张图出现两次
  // 候选色跟背景走：毛玻璃上用浅色，白底上回落到灰；启用自适应时作为目标色 F 参与推算
  const colPageTitle = bgOn ? COLOR_PAGE_TITLE : COLOR_PAGE_TITLE_PLAIN;
  const colPageDesc  = bgOn ? COLOR_PAGE_DESC  : COLOR_PAGE_DESC_PLAIN;
  const colUrl       = bgOn ? COLOR_URL_COVER  : COLOR_PAGE_TITLE_PLAIN;

  // 缩略图布局：和下方链接条同构——图在左，文本排其右侧
  const iconSize  = (note && cover) ? Math.min(footer_w * 0.21, footer_h * 0.80) : 0;
  const metaX     = iconSize ? infoLeft + iconSize + W * 0.03 : infoLeft;
  const metaW     = infoRight - metaX;

  const gapV = footer_h * 0.08;
  const ptitle = ellipsize(ctx, pageTitle || "未知页面标题", page_title_size, metaW);
  const pdesc = pageDesc ? ellipsize(ctx, pageDesc, page_desc_size, metaW) : "";

  if (pdesc) {
    const totalH = page_title_size + gapV + page_desc_size;
    const ty = footerY + (footer_h - totalH) / 2;
    paintFooter(metaX, ty, ptitle, page_title_size, colPageTitle);
    paintFooter(metaX, ty + page_title_size + gapV, pdesc, page_desc_size, colPageDesc);
  } else {
    paintFooter(metaX, footerY + (footer_h - page_title_size) / 2, ptitle, page_title_size, colPageTitle);
  }

  if (iconSize) {
    // 居中方形裁切 + 圆角，与文字块垂直居中，贴内容区左缘
    const s = Math.min(cover.width, cover.height);
    const ix = infoLeft;
    const iy = footerY + (footer_h - iconSize) / 2;
    ctx.save();
    roundBox(ix, iy, iconSize, iconSize, iconSize * 0.22);
    ctx.clip();
    ctx.drawImage(
      cover,
      (cover.width - s) / 2, (cover.height - s) / 2, s, s,
      ix, iy, iconSize, iconSize,
    );
    ctx.restore();
  }

  // ---------- 底部链接条：二维码在左，完整链接排其右侧 ----------
  if (urlLines.length || qr) {
    let ty = linkTop + (linkH - urlH) / 2;
    for (const line of urlLines) {
      paintFooter(urlX, ty, line, url_size, colUrl);
      ty += urlLineH;
    }

    if (qr) {
      const qx = infoLeft;
      const qy = linkTop + (linkH - qrBlock) / 2;

      // 半透明圆角白底
      ctx.fillStyle = COLOR_QR_BG;
      roundBox(qx, qy, qrBlock, qrBlock, W * 0.03);
      ctx.fill();

      const n = qr.count;
      const isFinder = (r, c) =>
        (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

      // 普通模块画成圆角小点；用标题同款深灰，比纯黑柔和，明度仍足够低
      ctx.fillStyle = COLOR_TITLE;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!qr.isDark(r, c) || isFinder(r, c)) continue;
          ctx.beginPath();
          ctx.roundRect(
            qx + qrPad + c * qrCell,
            qy + qrPad + r * qrCell,
            qrCell,
            qrCell,
            qrCell * 0.35
          );
          ctx.fill();
        }
      }

      // 三个定位角画成圆角环 + 圆角芯；识别靠 1:1:3:1:1 明暗比例，不要求方角
      ctx.strokeStyle = COLOR_TITLE;
      ctx.lineWidth = qrCell;
      const eye = 7 * qrCell;
      for (const [er, ec] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
        const ex = qx + qrPad + ec * qrCell;
        const ey = qy + qrPad + er * qrCell;
        ctx.beginPath();
        ctx.roundRect(ex + qrCell / 2, ey + qrCell / 2, eye - qrCell, eye - qrCell, qrCell * 2.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(ex + 2 * qrCell, ey + 2 * qrCell, 3 * qrCell, 3 * qrCell, qrCell * 1.2);
        ctx.fill();
      }
    }
  }

  return canvas;
}
