/** A GeoJSON position: longitude, latitude, then anything else. */
type Position = number[];
type Shape =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

const lonOf = (p: Position) => p[0] ?? 0;

/** A ring with points on both sides of 180° east, its western ones moved past 180°. */
function unwrapRing(ring: Position[]): Position[] {
  const crosses = ring.some((p) => lonOf(p) > 150) && ring.some((p) => lonOf(p) < -150);
  return crosses ? ring.map((p) => (lonOf(p) < 0 ? [lonOf(p) + 360, ...p.slice(1)] : p)) : ring;
}

/**
 * Russia and Fiji have rings that cross 180° east, which draw as lines across a flat world map.
 * Their western points move past 180° instead, so they stay where they belong (ADR 0014).
 */
export function unwrapAntimeridian<T extends Shape>(geometry: T): T {
  if (geometry.type === "Polygon") {
    return { ...geometry, coordinates: geometry.coordinates.map(unwrapRing) };
  }
  return {
    ...geometry,
    coordinates: geometry.coordinates.map((polygon) => polygon.map(unwrapRing)),
  };
}
