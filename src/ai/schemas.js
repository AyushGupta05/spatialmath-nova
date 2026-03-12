/**
 * SceneSpec schema definitions and validation.
 * This is the central data contract between Nova Pro output and the 3D renderer.
 */

const VALID_SHAPES = ["cube", "cuboid", "sphere", "cylinder", "cone", "line"];
const VALID_QUESTION_TYPES = ["volume", "surface_area", "composite", "spatial", "comparison"];
const VALID_LABEL_STYLES = ["dimension", "name", "formula", "annotation"];

const DEFAULT_COLORS = ["#7cf7e4", "#ff7ca8", "#48c9ff", "#ffd966", "#b088f9"];

/** Validate and fill defaults for a SceneSpec object */
export function validateSceneSpec(spec) {
  if (!spec || typeof spec !== "object") {
    throw new Error("SceneSpec must be an object");
  }

  return {
    question: spec.question || "",
    questionType: VALID_QUESTION_TYPES.includes(spec.questionType) ? spec.questionType : "volume",
    objects: (spec.objects || []).map((obj, i) => validateSceneObject(obj, i)),
    labels: (spec.labels || []).map(validateLabel),
    dimensions: (spec.dimensions || []).map(validateDimension),
    camera: validateCamera(spec.camera),
    answer: validateAnswer(spec.answer),
  };
}

function validateSceneObject(obj, index) {
  const shape = VALID_SHAPES.includes(obj.shape) ? obj.shape : "cube";
  return {
    id: obj.id || String.fromCharCode(65 + index), // A, B, C...
    shape,
    params: validateParams(shape, obj.params || {}),
    position: toVec3(obj.position, [0, 0, 0]),
    rotation: toVec3(obj.rotation, [0, 0, 0]),
    color: obj.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    highlight: Boolean(obj.highlight),
  };
}

function validateParams(shape, params) {
  switch (shape) {
    case "cube":
      return { size: params.size || 1 };
    case "cuboid":
      return {
        width: params.width || 1,
        height: params.height || 1,
        depth: params.depth || 1,
      };
    case "sphere":
      return { radius: params.radius || 1 };
    case "cylinder":
      return {
        radius: params.radius || 1,
        height: params.height || 2,
      };
    case "cone":
      return {
        radius: params.radius || 1,
        height: params.height || 2,
      };
    case "line":
      return {
        start: toVec3(params.start, [0, 0, 0]),
        end: toVec3(params.end, [1, 0, 0]),
      };
    default:
      return { size: params.size || 1 };
  }
}

function validateLabel(label) {
  return {
    text: label.text || "",
    attachTo: label.attachTo || "A",
    offset: toVec3(label.offset, [0, 1.5, 0]),
    style: VALID_LABEL_STYLES.includes(label.style) ? label.style : "dimension",
  };
}

function validateDimension(dim) {
  return {
    from: toVec3(dim.from, [0, 0, 0]),
    to: toVec3(dim.to, [1, 0, 0]),
    label: dim.label || "",
    color: dim.color || "#ffffff",
  };
}

function validateCamera(cam) {
  if (!cam) return { position: [8, 6, 8], target: [0, 0, 0] };
  return {
    position: toVec3(cam.position, [8, 6, 8]),
    target: toVec3(cam.target, [0, 0, 0]),
    fov: cam.fov || undefined,
  };
}

function validateAnswer(answer) {
  if (!answer) return null;
  return {
    value: answer.value ?? null,
    unit: answer.unit || "",
    formula: answer.formula || "",
    steps: (answer.steps || []).map((step, i) => ({
      index: i,
      text: step.text || "",
      formula: step.formula || "",
      highlightObjects: Array.isArray(step.highlightObjects) ? step.highlightObjects : [],
    })),
  };
}

function toVec3(arr, fallback) {
  if (Array.isArray(arr) && arr.length >= 3) {
    return [Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0];
  }
  return fallback;
}

/**
 * Compute the effective "size" parameter for world.buildMesh()
 * given a shape and its params from SceneSpec.
 */
export function sceneParamsToMeshSize(shape, params) {
  switch (shape) {
    case "cube":
      return params.size || 1;
    case "cuboid":
      // world.buildMesh("cuboid", size) produces BoxGeometry(size*1.6, size, size*0.9)
      // We want to match height = params.height, so size = params.height
      return params.height || 1;
    case "sphere":
      // world.buildMesh("sphere", size) produces SphereGeometry(size*0.6)
      // We want radius = params.radius, so size = params.radius / 0.6
      return (params.radius || 1) / 0.6;
    case "cylinder":
      // world.buildMesh("cylinder", size) produces CylinderGeometry(size*0.45, ..., size*1.4)
      // We want height = params.height, so size = params.height / 1.4
      return (params.height || 2) / 1.4;
    case "cone":
      return (params.height || 2) / 1.4;
    default:
      return params.size || 1;
  }
}

export { VALID_SHAPES, VALID_QUESTION_TYPES, DEFAULT_COLORS };
