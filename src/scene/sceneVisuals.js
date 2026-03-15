import { normalizeSceneObject } from "./schema.js";

export function sceneRoles(objectSpec = {}) {
  const spec = normalizeSceneObject(objectSpec);
  return new Set([
    spec.metadata?.role,
    ...(Array.isArray(spec.metadata?.roles) ? spec.metadata.roles : []),
  ].filter(Boolean).map((value) => String(value).toLowerCase()));
}

export function sceneObjectBaseOpacity(objectSpec) {
  const spec = normalizeSceneObject(objectSpec);
  if (spec.metadata?.physics?.kind === "flux_surface") {
    return 0.18;
  }
  if (spec.shape === "line") {
    return 0.78;
  }
  if (spec.shape === "plane") {
    const roles = sceneRoles(spec);
    const isReferencePlane = roles.has("plane")
      || roles.has("reference")
      || Array.isArray(spec.metadata?.normal)
      || typeof spec.metadata?.equation === "string";
    return isReferencePlane ? 0.28 : 1;
  }
  return 1;
}

export function shouldAccentIntersectionPoint(objectSpec) {
  const spec = normalizeSceneObject(objectSpec);
  if (spec.shape !== "pointMarker") return false;
  const id = String(spec.id || "").toLowerCase();
  const label = String(spec.label || "").toLowerCase();
  const roles = sceneRoles(spec);
  return roles.has("result") || id.includes("intersection") || label.includes("intersection");
}

export function shouldAccentNormalLine(objectSpec) {
  const spec = normalizeSceneObject(objectSpec);
  if (spec.shape !== "line") return false;
  const id = String(spec.id || "").toLowerCase();
  const label = String(spec.label || "").toLowerCase();
  const roles = sceneRoles(spec);
  return roles.has("normal") || id.includes("normal") || label.includes("normal");
}
