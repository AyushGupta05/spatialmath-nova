import { computeGeometry } from "../core/geometry.js";
import { distanceBetween } from "../scene/schema.js";

let sceneApi = null;
let drawerEl;
let titleEl;
let subtitleEl;
let statsEl;
let formulaEl;
let breakdownEl;
let netEl;
let closeBtn;
let activeObjectId = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function formatNumber(value, digits = 2) {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next.toFixed(digits).replace(/\.00$/, "") : "0";
}

function shapeTitle(shape) {
  const titles = {
    cube: "Cube",
    cuboid: "Cuboid",
    sphere: "Sphere",
    cylinder: "Cylinder",
    cone: "Cone",
    pyramid: "Square Pyramid",
    plane: "Plane",
    line: "Line",
  };
  return titles[shape] || "Object";
}

function metricsForObject(objectSpec) {
  return computeGeometry(objectSpec.shape, objectSpec.params);
}

function dimensionEntries(objectSpec) {
  const params = objectSpec.params || {};
  switch (objectSpec.shape) {
    case "cube":
      return [{ label: "Side", value: params.size }];
    case "cuboid":
      return [
        { label: "Width", value: params.width },
        { label: "Height", value: params.height },
        { label: "Depth", value: params.depth },
      ];
    case "sphere":
      return [{ label: "Radius", value: params.radius }];
    case "cylinder":
    case "cone":
      return [
        { label: "Radius", value: params.radius },
        { label: "Height", value: params.height },
      ];
    case "pyramid":
      return [
        { label: "Base", value: params.base },
        { label: "Height", value: params.height },
      ];
    case "plane":
      return [
        { label: "Width", value: params.width },
        { label: "Depth", value: params.depth },
      ];
    case "line":
      return [
        { label: "Length", value: distanceBetween(params.start, params.end) },
        { label: "Thickness", value: params.thickness },
      ];
    default:
      return [];
  }
}

function formulaForObject(objectSpec) {
  const params = objectSpec.params || {};
  switch (objectSpec.shape) {
    case "cube":
      return `Surface area = 6s^2 = 6(${formatNumber(params.size)}^2)`;
    case "cuboid":
      return `Surface area = 2(wh + wd + hd)`;
    case "cylinder":
      return `Surface area = 2pi r^2 + 2pi rh`;
    case "cone":
      return `Surface area = pi r^2 + pi r l`;
    case "pyramid":
      return `Surface area = b^2 + 2bl`;
    case "sphere":
      return `Surface area = 4pi r^2`;
    default:
      return "Surface area breakdown unavailable for this helper object.";
  }
}

function breakdownForObject(objectSpec) {
  const params = objectSpec.params || {};
  const metrics = metricsForObject(objectSpec);
  switch (objectSpec.shape) {
    case "cube": {
      const faceArea = params.size * params.size;
      return [
        `Each square face: ${formatNumber(params.size)} x ${formatNumber(params.size)} = ${formatNumber(faceArea)}`,
        `6 faces: 6 x ${formatNumber(faceArea)} = ${formatNumber(metrics.surfaceArea)}`,
      ];
    }
    case "cuboid": {
      const wh = params.width * params.height;
      const wd = params.width * params.depth;
      const hd = params.height * params.depth;
      return [
        `Front/back: 2 x (${formatNumber(params.width)} x ${formatNumber(params.height)}) = ${formatNumber(2 * wh)}`,
        `Top/bottom: 2 x (${formatNumber(params.width)} x ${formatNumber(params.depth)}) = ${formatNumber(2 * wd)}`,
        `Sides: 2 x (${formatNumber(params.height)} x ${formatNumber(params.depth)}) = ${formatNumber(2 * hd)}`,
        `Total surface area = ${formatNumber(metrics.surfaceArea)}`,
      ];
    }
    case "cylinder": {
      const baseArea = Math.PI * params.radius * params.radius;
      const wrapArea = 2 * Math.PI * params.radius * params.height;
      return [
        `Top circle: pi x ${formatNumber(params.radius)}^2 = ${formatNumber(baseArea)}`,
        `Bottom circle: pi x ${formatNumber(params.radius)}^2 = ${formatNumber(baseArea)}`,
        `Wrapped rectangle: (2pi x ${formatNumber(params.radius)}) x ${formatNumber(params.height)} = ${formatNumber(wrapArea)}`,
        `Total surface area = ${formatNumber(metrics.surfaceArea)}`,
      ];
    }
    case "cone": {
      const slant = Math.sqrt((params.radius ** 2) + (params.height ** 2));
      const baseArea = Math.PI * params.radius * params.radius;
      const lateralArea = Math.PI * params.radius * slant;
      return [
        `Base circle: pi x ${formatNumber(params.radius)}^2 = ${formatNumber(baseArea)}`,
        `Slant height: sqrt(r^2 + h^2) = ${formatNumber(slant)}`,
        `Sector area: pi x ${formatNumber(params.radius)} x ${formatNumber(slant)} = ${formatNumber(lateralArea)}`,
        `Total surface area = ${formatNumber(metrics.surfaceArea)}`,
      ];
    }
    case "pyramid": {
      const slant = Math.sqrt(((params.base / 2) ** 2) + (params.height ** 2));
      const baseArea = params.base * params.base;
      const trianglesArea = 2 * params.base * slant;
      return [
        `Square base: ${formatNumber(params.base)}^2 = ${formatNumber(baseArea)}`,
        `Slant height: sqrt((b/2)^2 + h^2) = ${formatNumber(slant)}`,
        `4 side triangles together: 2 x ${formatNumber(params.base)} x ${formatNumber(slant)} = ${formatNumber(trianglesArea)}`,
        `Total surface area = ${formatNumber(metrics.surfaceArea)}`,
      ];
    }
    case "sphere":
      return [
        "A sphere cannot be flattened into a true net without distortion.",
        `Nova still computes its surface area with 4pi r^2 = ${formatNumber(metrics.surfaceArea)}.`,
      ];
    default:
      return ["Unfold view is designed for solids and surface-area reasoning."];
  }
}

function rect(x, y, w, h, fill = "rgba(122, 247, 228, 0.14)") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="rgba(122,247,228,0.75)" stroke-width="2" />`;
}

function circle(cx, cy, r) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(72, 201, 255, 0.12)" stroke="rgba(72,201,255,0.82)" stroke-width="2" />`;
}

function polygon(points, fill = "rgba(255, 217, 102, 0.14)") {
  return `<polygon points="${points}" fill="${fill}" stroke="rgba(255,217,102,0.9)" stroke-width="2" />`;
}

function text(x, y, value) {
  return `<text x="${x}" y="${y}" fill="#e8fbff" font-size="14" font-family="Space Grotesk, sans-serif" text-anchor="middle">${escapeHtml(value)}</text>`;
}

function cuboidNetSvg(width, height, depth) {
  const scale = 28;
  const w = Math.max(40, width * scale);
  const h = Math.max(40, height * scale);
  const d = Math.max(34, depth * scale);
  const totalWidth = d + w + d + w + 48;
  const totalHeight = d + h + d + 48;
  const x0 = 24;
  const y0 = 24 + d;
  const parts = [
    rect(x0, y0, d, h),
    rect(x0 + d, y0, w, h),
    rect(x0 + d + w, y0, d, h),
    rect(x0 + d + w + d, y0, w, h),
    rect(x0 + d, y0 - d, w, d),
    rect(x0 + d, y0 + h, w, d),
    text(x0 + d + (w / 2), y0 - 10, "top"),
    text(x0 + d + (w / 2), y0 + h + d + 20, "bottom"),
    text(x0 + d + (w / 2), y0 + h / 2, "front"),
  ];
  return `<svg viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="Cuboid net">${parts.join("")}</svg>`;
}

function cylinderNetSvg(radius, height) {
  const scale = 18;
  const circumference = 2 * Math.PI * radius;
  const rectWidth = Math.max(80, circumference * scale);
  const rectHeight = Math.max(60, height * scale);
  const circleRadius = Math.max(26, radius * scale);
  const totalWidth = rectWidth + 48;
  const totalHeight = rectHeight + (circleRadius * 4) + 64;
  const x = 24;
  const y = circleRadius * 2 + 24;
  return `
    <svg viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="Cylinder net">
      ${rect(x, y, rectWidth, rectHeight)}
      ${circle(x + rectWidth / 2, 24 + circleRadius, circleRadius)}
      ${circle(x + rectWidth / 2, y + rectHeight + 24 + circleRadius, circleRadius)}
      ${text(x + rectWidth / 2, y + rectHeight / 2, "wrap")}
      ${text(x + rectWidth / 2, 20, "top")}
      ${text(x + rectWidth / 2, totalHeight - 10, "bottom")}
    </svg>
  `;
}

function coneNetSvg(radius, height) {
  const slant = Math.sqrt((radius ** 2) + (height ** 2));
  const sectorAngle = Math.min(330, (360 * radius) / Math.max(radius, slant));
  const scale = 22;
  const R = Math.max(42, slant * scale);
  const cx = R + 32;
  const cy = R + 32;
  const startAngle = (180 + (sectorAngle / 2)) * (Math.PI / 180);
  const endAngle = (180 - (sectorAngle / 2)) * (Math.PI / 180);
  const x1 = cx + (R * Math.cos(startAngle));
  const y1 = cy + (R * Math.sin(startAngle));
  const x2 = cx + (R * Math.cos(endAngle));
  const y2 = cy + (R * Math.sin(endAngle));
  const largeArcFlag = sectorAngle > 180 ? 1 : 0;
  const sector = `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArcFlag} 1 ${x2} ${y2} Z" fill="rgba(255, 217, 102, 0.14)" stroke="rgba(255,217,102,0.9)" stroke-width="2" />`;
  const baseRadius = Math.max(22, radius * scale);
  const totalWidth = (R * 2) + 72;
  const totalHeight = (R * 2) + (baseRadius * 2) + 88;
  return `
    <svg viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="Cone net">
      ${sector}
      ${circle(cx, totalHeight - baseRadius - 20, baseRadius)}
      ${text(cx, cy + 6, "sector")}
      ${text(cx, totalHeight - 12, "base")}
    </svg>
  `;
}

function pyramidNetSvg(base, height) {
  const slant = Math.sqrt(((base / 2) ** 2) + (height ** 2));
  const scale = 28;
  const b = Math.max(46, base * scale);
  const l = Math.max(46, slant * scale);
  const cx = (b / 2) + 90;
  const cy = l + 70;
  const x = cx - (b / 2);
  const y = cy - (b / 2);
  const top = `${cx},${cy - b / 2 - l} ${x},${y} ${x + b},${y}`;
  const bottom = `${cx},${cy + b / 2 + l} ${x},${y + b} ${x + b},${y + b}`;
  const left = `${cx - b / 2 - l},${cy} ${x},${y} ${x},${y + b}`;
  const right = `${cx + b / 2 + l},${cy} ${x + b},${y} ${x + b},${y + b}`;
  const totalWidth = (b + (l * 2)) + 180;
  const totalHeight = (b + (l * 2)) + 140;
  return `
    <svg viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="Square pyramid net">
      ${rect(x, y, b, b)}
      ${polygon(top)}
      ${polygon(bottom)}
      ${polygon(left)}
      ${polygon(right)}
      ${text(cx, cy + 4, "base")}
    </svg>
  `;
}

function sphereFallbackSvg(radius) {
  const r = Math.max(46, radius * 24);
  const size = (r * 2) + 48;
  return `
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Sphere illustration">
      ${circle(size / 2, size / 2, r)}
      <ellipse cx="${size / 2}" cy="${size / 2}" rx="${r * 0.9}" ry="${r * 0.28}" fill="none" stroke="rgba(255,217,102,0.7)" stroke-width="2" />
      <ellipse cx="${size / 2}" cy="${size / 2}" rx="${r * 0.45}" ry="${r * 0.9}" fill="none" stroke="rgba(122,247,228,0.7)" stroke-width="2" />
    </svg>
  `;
}

function renderNet(objectSpec) {
  const params = objectSpec.params || {};
  switch (objectSpec.shape) {
    case "cube":
      return cuboidNetSvg(params.size, params.size, params.size);
    case "cuboid":
      return cuboidNetSvg(params.width, params.height, params.depth);
    case "cylinder":
      return cylinderNetSvg(params.radius, params.height);
    case "cone":
      return coneNetSvg(params.radius, params.height);
    case "pyramid":
      return pyramidNetSvg(params.base, params.height);
    case "sphere":
      return `${sphereFallbackSvg(params.radius)}<p class="unfold-net-note">A sphere has no true flat net, so Nova shows a conceptual surface-area view instead.</p>`;
    default:
      return `<p class="unfold-net-note">This object does not have a supported unfold view yet.</p>`;
  }
}

function renderStats(objectSpec) {
  const metrics = metricsForObject(objectSpec);
  const dims = dimensionEntries(objectSpec)
    .map((entry) => `
      <div class="unfold-stat">
        <span class="unfold-stat-label">${escapeHtml(entry.label)}</span>
        <span class="unfold-stat-value">${formatNumber(entry.value)}</span>
      </div>
    `)
    .join("");

  return `
    ${dims}
    <div class="unfold-stat">
      <span class="unfold-stat-label">Surface Area</span>
      <span class="unfold-stat-value">${formatNumber(metrics.surfaceArea)}</span>
    </div>
    <div class="unfold-stat">
      <span class="unfold-stat-label">Volume</span>
      <span class="unfold-stat-value">${formatNumber(metrics.volume)}</span>
    </div>
  `;
}

function renderObject(objectSpec) {
  if (!drawerEl || !objectSpec) return;
  const metrics = metricsForObject(objectSpec);
  titleEl.textContent = `${shapeTitle(objectSpec.shape)} Unfold`;
  subtitleEl.textContent = objectSpec.shape === "sphere"
    ? "Surface area stays available even though a sphere cannot unfold into a true flat net."
    : `Inspect how Nova breaks the ${shapeTitle(objectSpec.shape).toLowerCase()}'s surface into 2D parts.`;
  statsEl.innerHTML = renderStats(objectSpec);
  formulaEl.textContent = `${formulaForObject(objectSpec)}  =>  ${formatNumber(metrics.surfaceArea)}`;
  breakdownEl.innerHTML = breakdownForObject(objectSpec)
    .map((item) => `<div class="unfold-breakdown-item">${escapeHtml(item)}</div>`)
    .join("");
  netEl.innerHTML = renderNet(objectSpec);
}

function openDrawer(objectId) {
  if (!sceneApi || !objectId) return;
  const objectSpec = sceneApi.getObject(objectId);
  if (!objectSpec) return;
  activeObjectId = objectId;
  drawerEl.classList.remove("hidden");
  drawerEl.setAttribute("aria-hidden", "false");
  renderObject(objectSpec);
}

function closeDrawer() {
  activeObjectId = null;
  drawerEl?.classList.add("hidden");
  drawerEl?.setAttribute("aria-hidden", "true");
}

export function initUnfoldDrawer(context) {
  sceneApi = context.sceneApi;
  drawerEl = document.getElementById("unfoldDrawer");
  titleEl = document.getElementById("unfoldTitle");
  subtitleEl = document.getElementById("unfoldSubtitle");
  statsEl = document.getElementById("unfoldStats");
  formulaEl = document.getElementById("unfoldFormula");
  breakdownEl = document.getElementById("unfoldBreakdown");
  netEl = document.getElementById("unfoldNet");
  closeBtn = document.getElementById("unfoldCloseBtn");

  closeBtn?.addEventListener("click", closeDrawer);
  sceneApi?.onObjectContextMenu?.(({ objectId }) => openDrawer(objectId));
  sceneApi?.onSceneChange?.(() => {
    if (!activeObjectId) return;
    const objectSpec = sceneApi.getObject(activeObjectId);
    if (!objectSpec) {
      closeDrawer();
      return;
    }
    renderObject(objectSpec);
  });
}

export function syncUnfoldDrawer() {
  if (!activeObjectId || !sceneApi) return;
  const objectSpec = sceneApi.getObject(activeObjectId);
  if (!objectSpec) {
    closeDrawer();
    return;
  }
  renderObject(objectSpec);
}
