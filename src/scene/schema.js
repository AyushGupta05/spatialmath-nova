const DEFAULT_POSITION = [0, 0, 0];
const DEFAULT_ROTATION = [0, 0, 0];
const DEFAULT_COLOR = "#7cf7e4";

export const SCENE_SHAPES = [
  "cube",
  "cuboid",
  "sphere",
  "cylinder",
  "cone",
  "pyramid",
  "plane",
  "line",
  "pointMarker",
];

export const EDITABLE_SHAPES = [
  "cube",
  "cuboid",
  "sphere",
  "cylinder",
  "cone",
  "pyramid",
  "plane",
  "line",
];

export const DEFAULT_SPAWN_PARAMS = {
  cube: { size: 1 },
  cuboid: { width: 1, height: 1, depth: 1 },
  sphere: { radius: 0.5 },
  cylinder: { radius: 0.4, height: 1 },
  cone: { radius: 0.5, height: 1 },
  pyramid: { base: 1, height: 1 },
  plane: { width: 2, depth: 2 },
  line: { start: [0, 0.03, 0], end: [1, 0.03, 0], thickness: 0.08 },
  pointMarker: { radius: 0.08 },
};

function normalizeNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeVec3(value, fallback = DEFAULT_POSITION) {
  if (!Array.isArray(value) || value.length < 3) {
    return [...fallback];
  }
  return [
    normalizeNumber(value[0], fallback[0]),
    normalizeNumber(value[1], fallback[1]),
    normalizeNumber(value[2], fallback[2]),
  ];
}

function normalizeShape(shape) {
  return SCENE_SHAPES.includes(shape) ? shape : "cube";
}

export function defaultParamsForShape(shape) {
  const normalizedShape = normalizeShape(shape);
  return structuredClone(DEFAULT_SPAWN_PARAMS[normalizedShape] || DEFAULT_SPAWN_PARAMS.cube);
}

export function normalizeParams(shape, params = {}) {
  const normalizedShape = normalizeShape(shape);
  const defaults = defaultParamsForShape(normalizedShape);

  switch (normalizedShape) {
    case "cube":
      return { size: normalizeNumber(params.size, defaults.size) };
    case "cuboid":
      return {
        width: normalizeNumber(params.width, defaults.width),
        height: normalizeNumber(params.height, defaults.height),
        depth: normalizeNumber(params.depth, defaults.depth),
      };
    case "sphere":
      return { radius: normalizeNumber(params.radius, defaults.radius) };
    case "cylinder":
    case "cone":
      return {
        radius: normalizeNumber(params.radius, defaults.radius),
        height: normalizeNumber(params.height, defaults.height),
      };
    case "pyramid":
      return {
        base: normalizeNumber(params.base, defaults.base),
        height: normalizeNumber(params.height, defaults.height),
      };
    case "plane":
      return {
        width: normalizeNumber(params.width, defaults.width),
        depth: normalizeNumber(params.depth, defaults.depth),
      };
    case "line":
      return {
        start: normalizeVec3(params.start, defaults.start),
        end: normalizeVec3(params.end, defaults.end),
        thickness: normalizeNumber(params.thickness, defaults.thickness),
      };
    case "pointMarker":
      return { radius: normalizeNumber(params.radius, defaults.radius) };
    default:
      return defaults;
  }
}

export function normalizeSceneObject(spec = {}) {
  const shape = normalizeShape(spec.shape);
  const params = normalizeParams(shape, spec.params || {});
  const metadata = spec.metadata && typeof spec.metadata === "object" ? { ...spec.metadata } : {};
  return {
    id: spec.id || null,
    label: spec.label || metadata.label || null,
    shape,
    color: typeof spec.color === "string" ? spec.color : DEFAULT_COLOR,
    position: normalizeVec3(spec.position, defaultPositionForShape(shape, params)),
    rotation: normalizeVec3(spec.rotation, DEFAULT_ROTATION),
    params,
    optional: Boolean(spec.optional),
    metadata,
  };
}

export function normalizeSceneSnapshot(snapshot = {}) {
  return {
    objects: Array.isArray(snapshot.objects) ? snapshot.objects.map(normalizeSceneObject) : [],
    selectedObjectId: snapshot.selectedObjectId || null,
  };
}

export function defaultPositionForShape(shape, params = defaultParamsForShape(shape)) {
  switch (shape) {
    case "cube":
      return [0, params.size / 2, 0];
    case "cuboid":
      return [0, params.height / 2, 0];
    case "sphere":
      return [0, params.radius, 0];
    case "cylinder":
    case "cone":
    case "pyramid":
      return [0, params.height / 2, 0];
    case "plane":
      return [0, 0, 0];
    case "pointMarker":
      return [0, params.radius, 0];
    case "line":
      return [0.5, 0.03, 0];
    default:
      return [...DEFAULT_POSITION];
  }
}

export function paramsToBaseSize(shape, params = defaultParamsForShape(shape)) {
  switch (shape) {
    case "cube":
      return params.size;
    case "cuboid":
      return Math.max(params.width, params.height, params.depth);
    case "sphere":
      return params.radius * 2;
    case "cylinder":
      return params.height;
    case "cone":
      return params.height;
    case "pyramid":
      return Math.max(params.base, params.height);
    case "plane":
      return Math.max(params.width, params.depth) / 2;
    case "line":
      return Math.max(params.thickness || 0.08, distanceBetween(params.start, params.end));
    case "pointMarker":
      return params.radius * 2;
    default:
      return 1;
  }
}

export function scaleSceneParams(shape, params = defaultParamsForShape(shape), scale = 1) {
  const nextScale = normalizeNumber(scale, 1);
  const normalized = normalizeParams(shape, params);

  switch (shape) {
    case "cube":
      return { size: normalized.size * nextScale };
    case "cuboid":
      return {
        width: normalized.width * nextScale,
        height: normalized.height * nextScale,
        depth: normalized.depth * nextScale,
      };
    case "sphere":
      return { radius: normalized.radius * nextScale };
    case "cylinder":
    case "cone":
      return {
        radius: normalized.radius * nextScale,
        height: normalized.height * nextScale,
      };
    case "pyramid":
      return {
        base: normalized.base * nextScale,
        height: normalized.height * nextScale,
      };
    case "plane":
      return {
        width: normalized.width * nextScale,
        depth: normalized.depth * nextScale,
      };
    case "line": {
      const start = normalizeVec3(normalized.start, DEFAULT_POSITION);
      const end = normalizeVec3(normalized.end, [1, 0, 0]);
      const midpoint = [
        (start[0] + end[0]) * 0.5,
        (start[1] + end[1]) * 0.5,
        (start[2] + end[2]) * 0.5,
      ];
      return {
        start: midpoint.map((value, index) => value + (start[index] - value) * nextScale),
        end: midpoint.map((value, index) => value + (end[index] - value) * nextScale),
        thickness: normalized.thickness * nextScale,
      };
    }
    case "pointMarker":
      return { radius: normalized.radius * nextScale };
    default:
      return normalized;
  }
}

export function baseSizeToParams(shape, baseSize = 1) {
  const size = normalizeNumber(baseSize, 1);
  switch (shape) {
    case "cube":
      return { size };
    case "cuboid":
      return { width: size, height: size, depth: size };
    case "sphere":
      return { radius: size / 2 };
    case "cylinder":
      return { radius: size * 0.4, height: size };
    case "cone":
      return { radius: size * 0.5, height: size };
    case "pyramid":
      return { base: size, height: size };
    case "plane":
      return { width: size * 2, depth: size * 2 };
    case "line":
      return { start: [0, 0.03, 0], end: [size, 0.03, 0], thickness: DEFAULT_SPAWN_PARAMS.line.thickness };
    case "pointMarker":
      return { radius: Math.max(0.08, size * 0.08) };
    default:
      return defaultParamsForShape(shape);
  }
}

export function sceneObjectToLegacyItem(spec = {}) {
  const normalized = normalizeSceneObject(spec);
  return {
    id: normalized.id || undefined,
    label: normalized.label || undefined,
    shape: normalized.shape,
    baseSize: paramsToBaseSize(normalized.shape, normalized.params),
    floorLocked: normalized.shape !== "plane" ? normalized.position[1] >= 0 : true,
    color: normalized.color,
    position: [...normalized.position],
    rotation: [...normalized.rotation],
    rotationY: normalized.rotation[1],
    scale: [1, 1, 1],
    params: structuredClone(normalized.params),
    lineStart: normalized.shape === "line" ? [...normalized.params.start] : null,
    lineEnd: normalized.shape === "line" ? [...normalized.params.end] : null,
    metadata: normalized.metadata,
  };
}

export function legacyItemToSceneObject(item = {}) {
  const shape = normalizeShape(item.shape);
  const legacyScale = Array.isArray(item.scale) && item.scale.length >= 3
    ? [
      normalizeNumber(item.scale[0], 1),
      normalizeNumber(item.scale[1], 1),
      normalizeNumber(item.scale[2], 1),
    ]
    : [1, 1, 1];
  const paramsSource = item.params && typeof item.params === "object"
    ? item.params
    : scaleLegacyParams(shape, baseSizeToParams(shape, item.baseSize || 1), legacyScale);
  const params = normalizeParams(shape, paramsSource);

  if (shape === "line") {
    params.start = normalizeVec3(item.lineStart || params.start, params.start);
    params.end = normalizeVec3(item.lineEnd || params.end, params.end);
  }

  return normalizeSceneObject({
    id: item.id || null,
    label: item.label || null,
    shape,
    color: item.color || DEFAULT_COLOR,
    position: Array.isArray(item.position) ? item.position : defaultPositionForShape(shape, params),
    rotation: Array.isArray(item.rotation)
      ? item.rotation
      : [0, normalizeNumber(item.rotationY, 0), 0],
    params,
    metadata: item.metadata || {},
  });
}

function scaleLegacyParams(shape, params, scale) {
  switch (shape) {
    case "cube":
      return { size: params.size * Math.max(...scale) };
    case "cuboid":
      return {
        width: params.width * scale[0],
        height: params.height * scale[1],
        depth: params.depth * scale[2],
      };
    case "sphere":
      return { radius: params.radius * Math.max(...scale) };
    case "cylinder":
    case "cone":
      return {
        radius: params.radius * Math.max(scale[0], scale[2]),
        height: params.height * scale[1],
      };
    case "pyramid":
      return {
        base: params.base * Math.max(scale[0], scale[2]),
        height: params.height * scale[1],
      };
    case "plane":
      return {
        width: params.width * scale[0],
        depth: params.depth * scale[2],
      };
    default:
      return params;
  }
}

export function distanceBetween(from = DEFAULT_POSITION, to = DEFAULT_POSITION) {
  return Math.hypot(
    normalizeNumber(to[0], 0) - normalizeNumber(from[0], 0),
    normalizeNumber(to[1], 0) - normalizeNumber(from[1], 0),
    normalizeNumber(to[2], 0) - normalizeNumber(from[2], 0)
  );
}
