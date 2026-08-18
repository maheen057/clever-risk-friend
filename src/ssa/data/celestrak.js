import { buildRiskCells, debrisDensity, orbitType, visualRadius } from "./fallbackData";

const MU = 398600.4418; // km^3/s^2
const EARTH_RADIUS_KM = 6378.137;

/**
 * Fetch live CelesTrak GP (TLE-derived) elements through the app's server proxy
 * and convert them into the SSA catalog snapshot shape used by the globe.
 * Returns null when the live feed is unavailable so callers can fall back.
 */
export async function fetchCelestrakSnapshot(forecastHours = 0, { signal } = {}) {
  const response = await fetch("/api/public/celestrak", { signal });
  if (!response.ok) return null;
  const payload = await response.json();
  const records = payload?.records || [];
  if (!records.length) return null;

  const objects = records.map(toCatalogObject).filter(Boolean);
  if (!objects.length) return null;

  const risk_cells = buildRiskCells(objects, forecastHours);
  const active = objects.filter((item) => item.category === "active").length;

  return {
    generated_at: payload.fetched_at || new Date().toISOString(),
    source: payload.source || "CelesTrak GP (real-time TLE)",
    tle_epoch: records[0]?.EPOCH || null,
    live: true,
    stats: {
      tracked_objects: objects.length,
      active_satellites: active,
      debris_objects: objects.length - active,
      leo: objects.filter((item) => item.band === "LEO").length,
      meo: objects.filter((item) => item.band === "MEO").length,
      geo: objects.filter((item) => item.band === "GEO").length,
      global_risk: mean(risk_cells.slice(0, 10).map((cell) => cell.probability)),
      forecast_trend: mean(risk_cells.slice(0, 12).map((cell) => cell.forecast_delta)),
      data_latency_seconds: 0,
    },
    objects,
    risk_cells,
  };
}

function toCatalogObject(record) {
  const meanMotion = Number(record.MEAN_MOTION);
  const inclination = Number(record.INCLINATION);
  if (!Number.isFinite(meanMotion) || meanMotion <= 0 || !Number.isFinite(inclination)) return null;

  const n = (meanMotion * 2 * Math.PI) / 86400; // rad/s
  const semiMajor = Math.cbrt(MU / (n * n));
  const altitude = semiMajor - EARTH_RADIUS_KM;
  if (!Number.isFinite(altitude) || altitude < 120 || altitude > 60000) return null;

  const velocity = Math.sqrt(MU / semiMajor);
  const band = altitude <= 2000 ? "LEO" : altitude <= 30000 ? "MEO" : "GEO";
  const name = String(record.OBJECT_NAME || record.OBJECT_ID || "UNKNOWN").trim();
  const objectType = classify(name, record.source_kind);
  const category = objectType === "ACTIVE_SATELLITE" ? "active" : "debris";

  const density = debrisDensity(altitude, inclination, category);
  const collisionProbability = clamp(
    0.05 + density * 0.45 + (category === "debris" ? 0.12 : 0.02),
    0.01,
    0.96,
  );
  const radius = visualRadius(altitude);
  const raan = Number(record.RA_OF_ASC_NODE) || 0;
  const meanAnomaly = Number(record.MEAN_ANOMALY) || 0;

  return {
    id: String(record.NORAD_CAT_ID ?? record.OBJECT_ID ?? name),
    name,
    category,
    object_type: objectType,
    source_group: record.source_group || "celestrak",
    band,
    orbit_type: orbitType(band, inclination),
    altitude_km: round(altitude, 2),
    inclination_deg: round(inclination, 2),
    velocity_kms: round(velocity, 3),
    collision_probability: round(collisionProbability, 4),
    debris_density: round(density, 4),
    future_risk: round(clamp(collisionProbability * 1.12, 0.01, 0.99), 4),
    epoch: record.EPOCH || null,
    position: [0, 0, 0],
    orbit: {
      visual_radius: round(radius, 4),
      inclination_deg: round(inclination, 3),
      raan_deg: round(raan, 3),
      phase_rad: round((meanAnomaly * Math.PI) / 180, 5),
      angular_rate: round(0.0028 + 0.073 / radius, 5),
      eccentricity: round(Number(record.ECCENTRICITY) || 0, 6),
    },
  };
}

function classify(name, sourceKind) {
  const upper = name.toUpperCase();
  if (upper.includes("DEB") || upper.includes("FRAG") || upper.includes("COOLANT"))
    return "SPACE_DEBRIS";
  if (upper.includes("R/B") || upper.includes("ROCKET")) return "ROCKET_BODY";
  if (sourceKind === "debris") return "SPACE_DEBRIS";
  return "ACTIVE_SATELLITE";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}
