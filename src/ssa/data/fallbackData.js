import { severityFromProbability } from "../utils/orbitalMath";

const BANDS = ["LEO", "MEO", "GEO"];
const INCLINATIONS = [28.5, 51.6, 63.4, 74, 82.5, 97.8];

export function createFallbackSnapshot(forecastHours = 0) {
  const objects = buildObjects(760);
  const risk_cells = buildRiskCells(objects, forecastHours);
  const active = objects.filter((item) => item.category === "active").length;
  const debris = objects.length - active;
  return {
    generated_at: new Date().toISOString(),
    source: "Synthetic offline SSA training feed",
    tle_epoch: null,
    stats: {
      tracked_objects: objects.length,
      active_satellites: active,
      debris_objects: debris,
      leo: objects.filter((item) => item.band === "LEO").length,
      meo: objects.filter((item) => item.band === "MEO").length,
      geo: objects.filter((item) => item.band === "GEO").length,
      global_risk: average(risk_cells.slice(0, 10).map((cell) => cell.probability)),
      forecast_trend: average(risk_cells.slice(0, 12).map((cell) => cell.forecast_delta)),
      data_latency_seconds: 0,
    },
    objects,
    risk_cells,
  };
}

export function createFallbackForecast(horizonHours = 168, steps = 9) {
  const objects = buildObjects(760);
  const frames = Array.from({ length: steps }, (_, index) => {
    const hour = Math.round((index * horizonHours) / Math.max(1, steps - 1));
    const cells = buildRiskCells(objects, hour).slice(0, 24);
    return {
      hour,
      global_risk: average(cells.slice(0, 8).map((cell) => cell.probability)),
      tracked_density: Math.min(1, objects.length / 1200),
      cells,
    };
  });
  return {
    generated_at: new Date().toISOString(),
    horizon_hours: horizonHours,
    frames,
  };
}

function buildObjects(count) {
  const rng = lcg(61137);
  return Array.from({ length: count }, (_, index) => {
    const roll = rng();
    let band = "LEO";
    let altitude = 720;
    let inclination = 97.8;
    let velocity = 7.5;

    if (roll < 0.72) {
      band = "LEO";
      altitude = pick(rng, [430, 540, 690, 820, 960, 1210, 1480]) + spread(rng, 85);
      inclination = pick(rng, INCLINATIONS) + spread(rng, 3.5);
      velocity = 7.15 + rng() * 0.72;
    } else if (roll < 0.9) {
      band = "MEO";
      altitude = pick(rng, [20180, 23220, 26560]) + spread(rng, 740);
      inclination = pick(rng, [54, 56, 63.4, 64.8]) + spread(rng, 2.8);
      velocity = 3.2 + rng() * 1.1;
    } else {
      band = "GEO";
      altitude = 35786 + spread(rng, 460);
      inclination = rng() * 8;
      velocity = 2.96 + rng() * 0.2;
    }

    const isDebris = rng() < (band === "LEO" ? 0.38 : 0.16);
    const category = isDebris ? "debris" : "active";
    const object_type = isDebris ? "SPACE_DEBRIS" : "ACTIVE_SATELLITE";

    // Use realistic names
    let name;
    if (isDebris) {
      // Simulate debris fragment naming: "PARENT DEB 123"
      const parentNames = ["IRIDIUM 33", "COSMOS 2251", "FENGYUN 1C", "NOAA 19", "IRIDIUM 7", "ISS"];
      const parent = parentNames[index % parentNames.length];
      const suffix = ["DEB", "FRAG", "R/B", "PK"][index % 4];
      name = `${parent} ${suffix} ${String(Math.floor(rng() * 999) + 1).padStart(3, "0")}`;
    } else {
      const activeNames = ["IRIDIUM 33", "NOAA 19", "GOES 16", "GALILEO 5", "ISS", "LANDSAT 8", "SENTINEL 1A", "GPS 2R-1", "STARLINK 1001", "ONEWEB 1"];
      name = activeNames[index % activeNames.length];
    }

    // Use simulated NORAD ID (5-digit number)
    const noradId = (10000 + index) % 99999;

    const density = debrisDensity(altitude, inclination, category);
    const collisionProbability = clamp(0.05 + density * 0.45 + (category === "debris" ? 0.12 : 0.02) + rng() * 0.1, 0.01, 0.96);
    const radius = visualRadius(altitude);
    const phase = rng() * Math.PI * 2;
    const raan = rng() * 360;

    return {
      id: `${noradId}`,
      name,
      category,
      object_type,
      band,
      orbit_type: orbitType(band, inclination),
      altitude_km: round(altitude, 2),
      inclination_deg: round(inclination, 2),
      velocity_kms: round(velocity, 3),
      collision_probability: round(collisionProbability, 4),
      debris_density: round(density, 4),
      future_risk: round(clamp(collisionProbability * (1.04 + rng() * 0.24), 0.01, 0.99), 4),
      position: [0, 0, 0],
      orbit: {
        visual_radius: round(radius, 4),
        inclination_deg: round(inclination, 3),
        raan_deg: round(raan, 3),
        phase_rad: round(phase, 5),
        angular_rate: round(0.0028 + 0.073 / radius, 5),
        eccentricity: round(rng() * 0.014, 6),
      },
    };
  });
}

export function buildRiskCells(objects, forecastHours) {
  const buckets = new Map();
  for (const object of objects) {
    const altitudeBin = Math.round(object.altitude_km / 400) * 400;
    const inclinationBin = Math.round(object.inclination_deg / 15) * 15;
    const key = `${object.band}:${altitudeBin}:${inclinationBin}`;
    if (!buckets.has(key)) {
      buckets.set(key, { band: object.band, altitudeBin, inclinationBin, members: [] });
    }
    buckets.get(key).members.push(object);
  }

  return Array.from(buckets.values())
    .filter((bucket) => bucket.members.length >= 3 || bucket.band === "GEO")
    .map((bucket, index) => {
      const density = clamp(bucket.members.length / (bucket.band === "LEO" ? 30 : 16), 0, 1);
      const debrisRatio = bucket.members.filter((item) => item.category === "debris").length / bucket.members.length;
      const meanRisk = average(bucket.members.map((item) => item.collision_probability));
      const forecastDelta = growth(bucket.altitudeBin, bucket.inclinationBin, debrisRatio, forecastHours);
      const untrackedDensity = clamp(0.16 + density * 0.32 + debrisRatio * 0.45, 0, 1);
      const pressure = Math.max(
        gaussian(bucket.altitudeBin, 850, 540),
        gaussian(bucket.altitudeBin, 35786, 1900),
        gaussian(bucket.altitudeBin, 20200, 2800)
      );
      const probability = clamp(
        density * 0.28 + debrisRatio * 0.19 + meanRisk * 0.26 + untrackedDensity * 0.16 + pressure * 0.16 + forecastDelta * 0.17,
        0.04,
        0.98
      );
      const severity = severityFromProbability(probability);
      const contributors = bucket.members
        .slice()
        .sort((a, b) => b.collision_probability - a.collision_probability)
        .slice(0, 4)
        .map((item) => item.name);

      return {
        id: `FALLBACK-RISK-${bucket.band}-${bucket.altitudeBin}-${bucket.inclinationBin}-${index}`,
        band: bucket.band,
        altitude_km: bucket.altitudeBin,
        inclination_deg: bucket.inclinationBin,
        raan_deg: (index * 47 + bucket.altitudeBin * 0.03) % 360,
        severity,
        probability: round(probability, 4),
        density: round(density, 4),
        untracked_density: round(untrackedDensity, 4),
        forecast_delta: round(forecastDelta, 4),
        uncertainty: round(clamp(0.18 + untrackedDensity * 0.52 + forecastHours / 430, 0.05, 0.94), 4),
        contributors,
        explanation: `${bucket.band} risk near ${bucket.altitudeBin.toLocaleString()} km and ${bucket.inclinationBin} deg inclination is driven by ${debrisRatio > 0.3 ? "fragmentation debris concentration" : "dense orbital traffic"} and forecasted crossing geometry.`,
      };
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 48);
}

export function debrisDensity(altitude, inclination, category) {
  return clamp(
    0.08 +
      gaussian(altitude, 820, 420) * 0.42 +
      gaussian(inclination, 98, 11) * 0.22 +
      gaussian(altitude, 35786, 1800) * 0.24 +
      (category === "debris" ? 0.2 : 0),
    0.02,
    0.98
  );
}

export function orbitType(band, inclination) {
  if (band === "GEO") return "Geostationary belt";
  if (band === "MEO") return "Navigation/MEO shell";
  if (inclination > 80) return "Polar LEO";
  if (inclination > 45) return "High-inclination LEO";
  return "Low-inclination LEO";
}

export function visualRadius(altitude) {
  if (altitude <= 2000) return 2.22 + altitude / 1850;
  if (altitude <= 30000) return 3.55 + (altitude - 2000) / 3400;
  return 11.75 + Math.min(5.5, (altitude - 30000) / 2500);
}

function growth(altitude, inclination, debrisRatio, hours) {
  const temporal = Math.min(1, Math.max(0, hours) / 168);
  const wave = 0.5 + 0.5 * Math.sin(hours / 18 + altitude / 950 + inclination / 19);
  const fragmentation = gaussian(altitude, 850, 620) * (0.3 + debrisRatio);
  return clamp(temporal * (0.26 + wave * 0.38 + fragmentation * 0.42), 0, 1);
}

function gaussian(value, center, width) {
  return Math.exp(-(((value - center) / width) ** 2));
}

function lcg(seed) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function spread(rng, amount) {
  return (rng() - 0.5) * 2 * amount;
}

function average(values) {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
