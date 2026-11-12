export interface Point {
  x: number;
  y: number;
}

/**
 * Generates an SVG path data string using Catmull-Rom to Cubic Bézier spline.
 * Passes smoothly through every data point without angular kinks.
 */
export function getSmoothLinePath(
  points: Point[],
  minY: number,
  maxY: number
): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to cubic Bézier control points (tension = 0.5)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    let cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    let cp2y = p2.y - (p3.y - p1.y) / 6;

    // Clamp vertical control points to stay strictly within chart boundaries
    cp1y = Math.max(minY, Math.min(maxY, cp1y));
    cp2y = Math.max(minY, Math.min(maxY, cp2y));

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return path;
}

/**
 * Creates a closed SVG area path for soft gradient fill underneath the smooth curve.
 */
export function getSmoothAreaPath(
  points: Point[],
  baselineY: number,
  minY: number,
  maxY: number
): string {
  if (points.length === 0) return "";
  const linePath = getSmoothLinePath(points, minY, maxY);
  const firstX = points[0].x.toFixed(1);
  const lastX = points[points.length - 1].x.toFixed(1);
  const base = baselineY.toFixed(1);

  return `${linePath} L ${lastX} ${base} L ${firstX} ${base} Z`;
}

/**
 * Computes a clean 4-interval upper bound so Y-axis ticks stay legible
 * (e.g. 0, 2,5jt, 5jt, 7,5jt, 10jt) without multi-decimal clutter.
 */
export function getNiceMaxValue(rawMax: number): number {
  const safeMax = Math.max(100_000, rawMax);
  const stepTarget = safeMax / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(stepTarget)));
  const residual = stepTarget / magnitude;

  let multiplier = 10;
  if (residual <= 1) multiplier = 1;
  else if (residual <= 1.5) multiplier = 1.5;
  else if (residual <= 2) multiplier = 2;
  else if (residual <= 2.5) multiplier = 2.5;
  else if (residual <= 3) multiplier = 3;
  else if (residual <= 5) multiplier = 5;

  return Math.round(multiplier * magnitude * 4);
}

export function formatAxisCompactRupiah(val: number): string {
  const abs = Math.abs(val);
  if (abs === 0) return "0";
  if (abs >= 1_000_000_000) {
    const num = new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 1,
    }).format(abs / 1_000_000_000);
    return `${num}M`;
  }
  if (abs >= 1_000_000) {
    const num = new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 1,
    }).format(abs / 1_000_000);
    return `${num}jt`;
  }
  if (abs >= 1_000) {
    return `${Math.round(abs / 1_000)}rb`;
  }
  return String(abs);
}

