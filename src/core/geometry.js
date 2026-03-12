const PI = Math.PI;

export function computeGeometry(shape, params) {
  switch (shape) {
    case "cube": {
      const a = Number(params.a ?? params.size ?? 1);
      return {
        shape,
        labels: { a },
        volume: a ** 3,
        surfaceArea: 6 * a * a,
      };
    }
    case "sphere": {
      const r = Number(params.r ?? params.radius ?? params.size ?? 1);
      return {
        shape,
        labels: { r },
        volume: (4 / 3) * PI * r ** 3,
        surfaceArea: 4 * PI * r ** 2,
      };
    }
    case "cylinder": {
      const r = Number(params.r ?? params.radius ?? 1);
      const h = Number(params.h ?? params.height ?? params.size ?? 1);
      return {
        shape,
        labels: { r, h },
        volume: PI * r * r * h,
        surfaceArea: 2 * PI * r * (r + h),
      };
    }
    case "cuboid": {
      const w = Number(params.w ?? params.width ?? 1.6);
      const h = Number(params.h ?? params.height ?? 1);
      const d = Number(params.d ?? params.depth ?? 0.9);
      return {
        shape,
        labels: { w, h, d },
        volume: w * h * d,
        surfaceArea: 2 * (w * h + w * d + h * d),
      };
    }
    case "line": {
      const length = Number(params.length ?? params.l ?? params.size ?? 1);
      return {
        shape,
        labels: { length },
        volume: 0,
        surfaceArea: 0,
      };
    }
    case "cone": {
      const r = Number(params.r ?? params.radius ?? 1);
      const h = Number(params.h ?? params.height ?? params.size ?? 1);
      const slant = Math.sqrt(r * r + h * h);
      return {
        shape,
        labels: { r, h },
        volume: (1 / 3) * PI * r * r * h,
        surfaceArea: PI * r * (r + slant),
      };
    }
    case "pyramid": {
      const base = Number(params.base ?? params.size ?? 1);
      const h = Number(params.h ?? params.height ?? 1);
      const slant = Math.sqrt((base / 2) * (base / 2) + h * h);
      return {
        shape,
        labels: { base, h },
        volume: (1 / 3) * base * base * h,
        surfaceArea: base * base + 2 * base * slant,
      };
    }
    case "plane": {
      const w = Number(params.w ?? params.width ?? 4);
      const d = Number(params.d ?? params.depth ?? 4);
      return {
        shape,
        labels: { w, d },
        volume: 0,
        surfaceArea: w * d,
      };
    }
    default:
      return computeGeometry("cube", { a: 1 });
  }
}
