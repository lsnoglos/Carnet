'use strict';

/** Editor de carnets UCC. Funciona sin internet y no envía datos del estudiante. */
(() => {
  const WIDTH = 529;
  const HEIGHT = 340;
  const CROP_SIZE = 400;
  const CROP_RATIO = 115 / 142;
  const YEAR_MIN = 1900;
  const YEAR_MAX = 2200;
  const templates = [
    { name: 'UCC oficial', src: 'modelos/modelo_1.png' },
    { name: 'Verde tierno', src: 'modelos/modelo_2.png' },
    { name: 'Verde y rojo', src: 'modelos/modelo_3.png' },
    { name: 'Tecnológico', src: 'modelos/modelo_4.png' }
  ];
  const byId = id => document.getElementById(id);
  const ids = ['carnet', 'nombre', 'carrera', 'turno', 'anio', 'campus'];
  const fields = Object.fromEntries(ids.map(id => [id, byId(id)]));
  const photoInput = byId('foto');
  const cropCanvas = byId('cropCanvas');
  const cropCtx = cropCanvas.getContext('2d');
  const preview = byId('previewCanvas');
  const ctx = preview.getContext('2d');
  const templateGrid = byId('modelGrid');
  const nowYear = new Date().getFullYear();
  let photo = null;
  let photoObjectURL = null;
  let imageLoadToken = 0;
  let imageArea = { x: 0, y: 0, w: CROP_SIZE, h: CROP_SIZE };
  let crop = { x: 120, y: 85, w: 160, h: 160 / CROP_RATIO };
  let drag = null;
  let brightness = 0;
  let modelIndex = 0;
  let toastTimer = null;

  const settings = {
    color: '#000000',
    opacity: 80,
    photoScale: 100,
    beautify: false,
    exportScale: 2
  };

  function prefRead(key) {
    try { return localStorage.getItem('uccCarnet2_' + key); }
    catch (_) { return null; }
  }
  function prefWrite(key, value) {
    try { localStorage.setItem('uccCarnet2_' + key, String(value)); }
    catch (_) { /* Algunos navegadores bloquean localStorage en file:// */ }
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function prefNumber(key, fallback, min, max) {
    const v = Number(prefRead(key));
    return prefRead(key) === null || !Number.isFinite(v) ? fallback : clamp(v, min, max);
  }
  function toast(message) {
    const el = byId('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }
  function selectedYear() {
    const value = fields.anio.value.trim();
    const n = Number(value);
    return /^\d{4}$/.test(value) && Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX ? value : '—';
  }
  function initYears() {
    const datalist = byId('aniosSugeridos');
    const begin = Math.max(YEAR_MIN, nowYear - 30);
    const end = Math.min(YEAR_MAX, nowYear + 40);
    for (let year = begin; year <= end; year++) {
      const opt = document.createElement('option');
      opt.value = String(year);
      datalist.appendChild(opt);
    }
    const saved = prefNumber('year', nowYear, YEAR_MIN, YEAR_MAX);
    fields.anio.value = String(saved);
    fields.anio.addEventListener('change', () => {
      if (selectedYear() === '—') {
        fields.anio.setCustomValidity(`Introduce un año entre ${YEAR_MIN} y ${YEAR_MAX}.`);
        fields.anio.reportValidity();
      } else {
        fields.anio.setCustomValidity('');
        prefWrite('year', fields.anio.value);
      }
      updatePreview();
    });
    fields.anio.addEventListener('input', () => {
      fields.anio.setCustomValidity('');
      if (selectedYear() !== '—') prefWrite('year', fields.anio.value);
    });
  }

  function roundedRect(g, x, y, w, h, r, fillColor, strokeColor, lineWidth = 1) {
    const radius = Math.min(r, w / 2, h / 2);
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, radius);
    else {
      g.moveTo(x + radius, y);
      g.lineTo(x + w - radius, y); g.quadraticCurveTo(x + w, y, x + w, y + radius);
      g.lineTo(x + w, y + h - radius); g.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      g.lineTo(x + radius, y + h); g.quadraticCurveTo(x, y + h, x, y + h - radius);
      g.lineTo(x, y + radius); g.quadraticCurveTo(x, y, x + radius, y);
    }
    g.closePath();
    if (fillColor) { g.fillStyle = fillColor; g.fill(); }
    if (strokeColor) { g.lineWidth = lineWidth; g.strokeStyle = strokeColor; g.stroke(); }
  }

  function drawBlankCrop() {
    const g = cropCtx;
    g.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    g.fillStyle = getComputedStyle(cropCanvas).backgroundColor || '#e8f1eb';
    g.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    g.fillStyle = '#8ba89a';
    g.beginPath(); g.arc(200, 170, 50, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(200, 296, 99, 69, 0, Math.PI, 0); g.fill();
    g.font = '600 17px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#516c5c';
    g.fillText('Selecciona una fotografía', 200, 374);
    g.textAlign = 'left';
  }

  function fitImageToCrop() {
    const scale = Math.min(CROP_SIZE / photo.naturalWidth, CROP_SIZE / photo.naturalHeight);
    const w = photo.naturalWidth * scale;
    const h = photo.naturalHeight * scale;
    imageArea = { x: (CROP_SIZE - w) / 2, y: (CROP_SIZE - h) / 2, w, h };
  }
  function resetCrop() {
    if (!photo) return;
    const h = Math.max(40, Math.min(230, imageArea.h - 12, (imageArea.w - 12) / CROP_RATIO));
    const w = h * CROP_RATIO;
    crop = { x: imageArea.x + (imageArea.w - w) / 2, y: imageArea.y + (imageArea.h - h) / 2, w, h };
    drawCrop(); updatePreview();
  }
  function drawCrop() {
    if (!photo) { drawBlankCrop(); return; }
    const g = cropCtx;
    g.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    g.fillStyle = '#e4ece6'; g.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    g.drawImage(photo, imageArea.x, imageArea.y, imageArea.w, imageArea.h);
    g.fillStyle = 'rgba(9, 23, 15, .47)';
    g.fillRect(0, 0, CROP_SIZE, crop.y);
    g.fillRect(0, crop.y + crop.h, CROP_SIZE, CROP_SIZE - crop.y - crop.h);
    g.fillRect(0, crop.y, crop.x, crop.h);
    g.fillRect(crop.x + crop.w, crop.y, CROP_SIZE - crop.x - crop.w, crop.h);
    g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.setLineDash([8, 4]);
    g.strokeRect(crop.x, crop.y, crop.w, crop.h); g.setLineDash([]);
    // Regla de tercios para facilitar el encuadre.
    g.strokeStyle = 'rgba(255,255,255,.43)'; g.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      g.beginPath(); g.moveTo(crop.x + crop.w * i / 3, crop.y); g.lineTo(crop.x + crop.w * i / 3, crop.y + crop.h); g.stroke();
      g.beginPath(); g.moveTo(crop.x, crop.y + crop.h * i / 3); g.lineTo(crop.x + crop.w, crop.y + crop.h * i / 3); g.stroke();
    }
    for (const [x, y] of corners()) {
      roundedRect(g, x - 6, y - 6, 12, 12, 3, '#fff', '#116744', 1.5);
    }
  }
  function corners() {
    return [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]];
  }
  function pointInCrop(event) {
    const rect = cropCanvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * CROP_SIZE / rect.width, y: (event.clientY - rect.top) * CROP_SIZE / rect.height };
  }
  function hitCrop(point) {
    for (let i = 0; i < 4; i++) {
      const [x, y] = corners()[i];
      if (Math.abs(point.x - x) <= 14 && Math.abs(point.y - y) <= 14) return { type: 'resize', corner: i };
    }
    if (point.x >= crop.x && point.x <= crop.x + crop.w && point.y >= crop.y && point.y <= crop.y + crop.h) return { type: 'move' };
    return null;
  }
  function onPointerDown(event) {
    if (!photo) return;
    const point = pointInCrop(event);
    const hit = hitCrop(point);
    if (!hit) return;
    drag = { ...hit, offsetX: point.x - crop.x, offsetY: point.y - crop.y };
    cropCanvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function onPointerMove(event) {
    if (!drag || !photo) return;
    const point = pointInCrop(event);
    const bounds = imageArea;
    if (drag.type === 'move') {
      crop.x = clamp(point.x - drag.offsetX, bounds.x, bounds.x + bounds.w - crop.w);
      crop.y = clamp(point.y - drag.offsetY, bounds.y, bounds.y + bounds.h - crop.h);
    } else {
      const corner = drag.corner;
      const fromLeft = corner === 0 || corner === 2;
      const fromTop = corner === 0 || corner === 1;
      const anchorX = fromLeft ? crop.x + crop.w : crop.x;
      const anchorY = fromTop ? crop.y + crop.h : crop.y;
      const maxW = Math.min(fromLeft ? anchorX - bounds.x : bounds.x + bounds.w - anchorX,
                            (fromTop ? anchorY - bounds.y : bounds.y + bounds.h - anchorY) * CROP_RATIO);
      const proposedW = Math.min(Math.abs(point.x - anchorX), Math.abs(point.y - anchorY) * CROP_RATIO);
      const minW = Math.min(48, maxW);
      const w = clamp(proposedW, minW, maxW);
      crop.w = w;
      crop.h = w / CROP_RATIO;
      crop.x = fromLeft ? anchorX - crop.w : anchorX;
      crop.y = fromTop ? anchorY - crop.h : anchorY;
    }
    drawCrop(); updatePreview();
    event.preventDefault();
  }
  function onPointerUp(event) {
    if (drag && cropCanvas.hasPointerCapture(event.pointerId)) cropCanvas.releasePointerCapture(event.pointerId);
    drag = null;
  }
  cropCanvas.addEventListener('pointerdown', onPointerDown);
  cropCanvas.addEventListener('pointermove', onPointerMove);
  cropCanvas.addEventListener('pointerup', onPointerUp);
  cropCanvas.addEventListener('pointercancel', onPointerUp);
  cropCanvas.addEventListener('lostpointercapture', () => { drag = null; });
  cropCanvas.addEventListener('keydown', event => {
    if (!photo || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const distance = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') crop.x -= distance;
    if (event.key === 'ArrowRight') crop.x += distance;
    if (event.key === 'ArrowUp') crop.y -= distance;
    if (event.key === 'ArrowDown') crop.y += distance;
    crop.x = clamp(crop.x, imageArea.x, imageArea.x + imageArea.w - crop.w);
    crop.y = clamp(crop.y, imageArea.y, imageArea.y + imageArea.h - crop.h);
    drawCrop(); updatePreview(); event.preventDefault();
  });

  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Selecciona un archivo de imagen válido.'); return; }
    const newURL = URL.createObjectURL(file);
    const loadToken = ++imageLoadToken;
    const candidate = new Image();
    candidate.onload = () => {
      if (loadToken !== imageLoadToken) { URL.revokeObjectURL(newURL); return; }
      if (photoObjectURL) URL.revokeObjectURL(photoObjectURL);
      photo = candidate;
      photoObjectURL = newURL;
      fitImageToCrop();
      resetCrop();
      byId('photoStatus').textContent = file.name.length > 24 ? file.name.slice(0, 21) + '…' : file.name;
      toast('Fotografía cargada. Puedes ajustar el encuadre.');
    };
    candidate.onerror = () => { URL.revokeObjectURL(newURL); if (loadToken === imageLoadToken) toast('No fue posible abrir esta fotografía.'); };
    candidate.src = newURL;
  });

  function sourceRect() {
    if (!photo) return null;
    const rect = imageArea;
    const x = clamp((crop.x - rect.x) / rect.w * photo.naturalWidth, 0, photo.naturalWidth - 1);
    const y = clamp((crop.y - rect.y) / rect.h * photo.naturalHeight, 0, photo.naturalHeight - 1);
    const w = Math.min(crop.w / rect.w * photo.naturalWidth, photo.naturalWidth - x);
    const h = Math.min(crop.h / rect.h * photo.naturalHeight, photo.naturalHeight - y);
    return { x, y, w, h };
  }
  /** La fotografía se coloca directamente sobre la plantilla, sin marcos ni fondo. */
  function drawPortrait(g, x, y, w, h) {
    if (!photo) return; // El modelo oficial deja el espacio vacío hasta cargar la foto.
    const src = sourceRect();
    if (!src || src.w <= 0 || src.h <= 0) return;
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.filter = `brightness(${100 + brightness}%)`;
    g.drawImage(photo, src.x, src.y, src.w, src.h, x, y, w, h);
    if (settings.beautify) {
      g.filter = `blur(0.55px) brightness(${100 + brightness}%)`;
      g.globalAlpha = .12;
      g.drawImage(photo, src.x, src.y, src.w, src.h, x, y, w, h);
    }
    g.restore();
  }

  function fitOneLine(g, content, x, y, maxWidth, fontSize, minSize, weight = '700') {
    const text = String(content || '—');
    let s = fontSize;
    while (s > minSize) {
      g.font = `${weight} ${s}px Arial, sans-serif`;
      if (g.measureText(text).width <= maxWidth) break;
      s -= .5;
    }
    g.font = `${weight} ${s}px Arial, sans-serif`;
    let trimmed = text;
    while (trimmed.length > 1 && g.measureText(trimmed).width > maxWidth) trimmed = trimmed.slice(0, -2).trimEnd() + '…';
    g.fillText(trimmed, x, y);
  }
  function twoLines(g, content, x, y, maxWidth, fontSize = 16) {
    const tokens = String(content || '—').trim().toUpperCase().split(/\s+/).filter(Boolean);
    g.font = `700 ${fontSize}px Arial, sans-serif`;
    const lines = [];
    let line = '';
    for (const word of tokens) {
      const candidate = line ? line + ' ' + word : word;
      if (g.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    if (lines.length > 2) {
      const remaining = lines.slice(1).join(' ');
      lines.length = 1; lines.push(remaining);
    }
    while (lines.length < 1) lines.push('—');
    lines.forEach((value, i) => fitOneLine(g, value, x, y + i * 17, maxWidth, fontSize, 11));
  }
  function drawLabel(g, content, x, y) {
    g.fillStyle = '#536d61'; g.font = '700 10px Arial, sans-serif';
    g.fillText(content, x, y);
  }

  /**
   * Posiciones oficiales sobre un lienzo de 529 × 340, tomadas del editor original.
   * El fondo ya contiene el escudo y los elementos gráficos UCC.
   * Evitar tarjetas, fondos para texto, bordes y placeholders sobre el carnet.
   */
  const OFFICIAL = Object.freeze({
    photoX: 15, photoY: 60, photoW: 115, photoH: 142,
    fieldsX: 136, nameY: 60 + 142 * .16, careerY: 60 + 142 * .55,
    shiftY: 60 + 142 * .95, headerX: WIDTH / 2, headerY: 38,
    numberX: 15 + 115 / 2.5, numberY: 60 + 142 + 64,
    campusX: WIDTH / 2.44, campusY: 325
  });

  /** Respeta el rótulo original de 16 px y limita a dos líneas cuando hay datos. */
  function drawOfficialField(g, caption, value, x, baseline, maxWidth) {
    const content = `${caption}${String(value || '').trim() ? ' ' + String(value).trim().toUpperCase() : ''}`;
    const tokens = content.split(/\s+/).filter(Boolean);
    g.font = 'bold 16px Arial, sans-serif';
    const lines = [];
    let line = '';
    for (const token of tokens) {
      const candidate = line ? line + ' ' + token : token;
      if (g.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else { lines.push(line); line = token; }
    }
    if (line) lines.push(line);
    if (!lines.length) return;
    // No invadir el siguiente campo: máximo dos líneas por dato.
    if (lines.length > 2) lines.splice(1, lines.length - 1, lines.slice(1).join(' '));
    lines.forEach((part, index) => fitOneLine(g, part, x, baseline + index * 18, maxWidth, 16, 12));
  }

  function render(g, multiplier) {
    g.save();
    g.setTransform(multiplier, 0, 0, multiplier, 0, 0);
    g.clearRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, WIDTH, HEIGHT);
    const template = templates[modelIndex].img;
    if (template && template.complete && template.naturalWidth > 0) {
      g.save();
      g.globalAlpha = settings.opacity / 100;
      g.drawImage(template, 0, 0, WIDTH, HEIGHT);
      g.restore();
    }
    g.fillStyle = settings.color;
    g.textAlign = 'center';
    fitOneLine(g, 'UNIVERSIDAD DE CIENCIAS COMERCIALES', OFFICIAL.headerX, OFFICIAL.headerY, 507, 21, 17);
    g.textAlign = 'left';

    // Imagen sin contorno; el tamaño máximo impide tapar las leyendas de la derecha.
    const photoW = OFFICIAL.photoW * settings.photoScale / 100;
    const photoH = OFFICIAL.photoH * settings.photoScale / 100;
    drawPortrait(g, OFFICIAL.photoX, OFFICIAL.photoY, photoW, photoH);

    g.fillStyle = settings.color;
    const fieldMaxWidth = 260; // Protege el escudo oficial situado a la derecha.
    drawOfficialField(g, 'NOMBRE:', fields.nombre.value, OFFICIAL.fieldsX, OFFICIAL.nameY, fieldMaxWidth);
    drawOfficialField(g, 'CARRERA:', fields.carrera.value, OFFICIAL.fieldsX, OFFICIAL.careerY, fieldMaxWidth);
    drawOfficialField(g, 'TURNO:', fields.turno.value, OFFICIAL.fieldsX, OFFICIAL.shiftY, fieldMaxWidth);

    // En el modelo oficial solo aparece el número cuando se introduce un valor.
    const number = fields.carnet.value.trim().toUpperCase();
    if (number) {
      g.fillStyle = settings.color;
      g.textAlign = 'left';
      fitOneLine(g, number, OFFICIAL.numberX, OFFICIAL.numberY, 330, 38, 17);
    }

    g.fillStyle = settings.color;
    g.textAlign = 'center';
    const campus = (fields.campus.value || 'LEÓN').trim().toUpperCase();
    const footer = `CAMPUS – ${campus} ${selectedYear()}`;
    fitOneLine(g, footer, OFFICIAL.campusX, OFFICIAL.campusY, 322, 17, 12);
    g.restore();
  }

  function updatePreview() {
    render(ctx, 1);
  }
  function addTemplates() {
    for (const [index, model] of templates.entries()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'model-choice';
      button.setAttribute('aria-label', 'Usar plantilla ' + model.name);
      button.setAttribute('aria-pressed', 'false');
      const img = document.createElement('img');
      img.src = model.src; img.alt = ''; img.loading = 'lazy';
      const span = document.createElement('span'); span.textContent = model.name;
      button.append(img, span);
      button.addEventListener('click', () => {
        modelIndex = index;
        refreshTemplateSelection();
        updatePreview();
      });
      templateGrid.appendChild(button);
      model.img = new Image();
      model.img.onload = updatePreview;
      model.img.onerror = () => toast(`No se encontró la imagen: ${model.src}. Mantén la carpeta «modelos».`);
      model.img.src = model.src;
    }
    // El modelo oficial siempre es el predeterminado, incluso con preferencias previas.
    modelIndex = 0;
    refreshTemplateSelection();
  }
  function refreshTemplateSelection() {
    [...templateGrid.children].forEach((button, index) => button.setAttribute('aria-pressed', String(index === modelIndex)));
    byId('modelLabel').textContent = templates[modelIndex].name;
  }
  function updateQualityLabel() {
    const s = settings.exportScale;
    byId('exportDimensions').textContent = `${WIDTH * s} × ${HEIGHT * s} px`;
  }
  function makeExportCanvas() {
    const scale = settings.exportScale;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * scale;
    canvas.height = HEIGHT * scale;
    render(canvas.getContext('2d'), scale);
    return canvas;
  }
  function safeFilePart(value) {
    const valueText = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return valueText.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').trim().replace(/\s+/g, '_').slice(0, 65) || 'SIN_CARNET';
  }
  function filename(ext) {
    const date = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `CARNETUCC_${safeFilePart(fields.carnet.value)}_${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${ext}`;
  }
  function downloadBlob(blob, name) {
    if (!blob) { toast('No fue posible preparar la descarga.'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }
  function warnPhoto() {
    if (!photo) toast('El carnet se generará sin fotografía. Puedes añadirla antes de exportar.');
  }
  function downloadPNG() {
    warnPhoto();
    const canvas = makeExportCanvas();
    canvas.toBlob(blob => downloadBlob(blob, filename('png')), 'image/png');
  }
  function canvasToBMP(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const rowBytes = Math.ceil(width * 3 / 4) * 4;
    const fileBytes = 54 + rowBytes * height;
    const buf = new ArrayBuffer(fileBytes);
    const view = new DataView(buf);
    view.setUint8(0, 0x42); view.setUint8(1, 0x4d);
    view.setUint32(2, fileBytes, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, -height, true); // BMP top-down
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, rowBytes * height, true);
    let offset = 54;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        view.setUint8(offset++, pixels[i + 2]);
        view.setUint8(offset++, pixels[i + 1]);
        view.setUint8(offset++, pixels[i]);
      }
      offset += rowBytes - width * 3;
    }
    return new Blob([buf], { type: 'image/bmp' });
  }
  function downloadBMP() {
    warnPhoto();
    downloadBlob(canvasToBMP(makeExportCanvas()), filename('bmp'));
  }
  function printCard() {
    const win = window.open('', '_blank', 'width=850,height=600');
    if (!win) { toast('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes.'); return; }
    const dataURL = makeExportCanvas().toDataURL('image/png');
    win.document.open();
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Imprimir carnet UCC</title><style>
      @page{margin:0}*{box-sizing:border-box}body{margin:0;padding:10mm;background:#fff;display:flex;align-items:flex-start;justify-content:center}
      img{display:block;width:85.6mm;height:54mm;object-fit:fill;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      @media print{html,body{padding:0;width:100%;height:100%;}body{display:block}img{margin:0;page-break-inside:avoid}}
    </style></head><body><img id="carnetImp" alt="Carnet UCC" src="${dataURL}"></body></html>`);
    win.document.close();
    const image = win.document.getElementById('carnetImp');
    const doPrint = () => { win.focus(); win.print(); };
    if (image.complete) setTimeout(doPrint, 50);
    else image.onload = doPrint;
  }
  function setupSettings() {
    const themePreference = prefRead('theme');
    const media = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    let dark = themePreference === null ? media : themePreference === 'dark';
    const applyTheme = () => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      byId('themeLabel').textContent = dark ? 'Modo claro' : 'Modo oscuro';
      byId('themeIcon').textContent = dark ? '☀' : '◐';
      byId('themeToggle').setAttribute('aria-pressed', String(dark));
      drawCrop();
    };
    byId('themeToggle').addEventListener('click', () => {
      dark = !dark;
      prefWrite('theme', dark ? 'dark' : 'light');
      applyTheme();
    });
    applyTheme();

    // El modelo institucional inicia siempre con letras negras.
    settings.color = '#000000';
    settings.opacity = prefNumber('opacity', 80, 30, 100);
    settings.photoScale = prefNumber('photoScale', 100, 80, 100);
    settings.beautify = prefRead('beautify') === 'true';
    settings.exportScale = prefNumber('exportScale', 2, 1, 3);
    byId('textColor').value = /^#[\da-fA-F]{6}$/.test(settings.color) ? settings.color : '#000000';
    settings.color = byId('textColor').value;
    byId('backgroundOpacity').value = String(settings.opacity);
    byId('opacityValue').textContent = settings.opacity + ' %';
    byId('photoSize').value = String(settings.photoScale);
    byId('photoSizeValue').textContent = settings.photoScale + ' %';
    byId('beautify').checked = settings.beautify;
    byId('exportScale').value = String(settings.exportScale);
    updateQualityLabel();
    byId('textColor').addEventListener('input', e => {
      settings.color = e.target.value;
      prefWrite('color', settings.color); updatePreview();
    });
    byId('backgroundOpacity').addEventListener('input', e => {
      settings.opacity = Number(e.target.value);
      byId('opacityValue').textContent = settings.opacity + ' %';
      prefWrite('opacity', settings.opacity); updatePreview();
    });
    byId('photoSize').addEventListener('input', e => {
      settings.photoScale = Number(e.target.value);
      byId('photoSizeValue').textContent = settings.photoScale + ' %';
      prefWrite('photoScale', settings.photoScale); updatePreview();
    });
    byId('beautify').addEventListener('change', e => {
      settings.beautify = e.target.checked;
      prefWrite('beautify', settings.beautify); updatePreview();
    });
    byId('exportScale').addEventListener('change', e => {
      settings.exportScale = Number(e.target.value);
      prefWrite('exportScale', settings.exportScale); updateQualityLabel();
    });
    function setBrightness(value) {
      brightness = clamp(value, -55, 75);
      byId('brightnessValue').textContent = (brightness > 0 ? '+' : '') + brightness + ' %';
      updatePreview();
    }
    byId('brightnessDown').addEventListener('click', () => setBrightness(brightness - 10));
    byId('brightnessUp').addEventListener('click', () => setBrightness(brightness + 10));
    byId('resetPhoto').addEventListener('click', () => {
      setBrightness(0);
      settings.photoScale = 100;
      byId('photoSize').value = '100'; byId('photoSizeValue').textContent = '100 %';
      prefWrite('photoScale', 100);
      if (photo) resetCrop();
      updatePreview(); toast('Se restablecieron el brillo, el tamaño y el encuadre.');
    });
  }

  initYears();
  setupSettings();
  addTemplates();
  for (const field of Object.values(fields)) field.addEventListener('input', updatePreview);
  byId('downloadPNG').addEventListener('click', downloadPNG);
  byId('downloadBMP').addEventListener('click', downloadBMP);
  byId('printCard').addEventListener('click', printCard);
  drawCrop();
  updatePreview();
})();
