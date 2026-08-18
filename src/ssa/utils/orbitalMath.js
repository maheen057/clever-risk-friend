import * as THREE from "three";

const ORBIT_X_AXIS = new THREE.Vector3(1, 0, 0);
const ORBIT_Y_AXIS = new THREE.Vector3(0, 1, 0);

export const RISK_COLORS = {
  low: "#28d8ff",
  moderate: "#ffd166",
  elevated: "#ff8a3d",
  severe: "#ff2f55",
};

export const BAND_COLORS = {
  LEO: "#42f5b3",
  MEO: "#ffd166",
  GEO: "#ff8a3d",
  HEO: "#d879ff",
};

export const RISK_ORDER = {
  low: 0,
  moderate: 1,
  elevated: 2,
  severe: 3,
};

export function severityFromProbability(probability) {
  if (probability < 0.33) return "low";
  if (probability < 0.52) return "moderate";
  if (probability < 0.72) return "elevated";
  return "severe";
}

export function degToRad(value) {
  return (value * Math.PI) / 180;
}

export function orbitPhase(orbit, elapsedSeconds = 0, forecastHours = 0) {
  return (orbit.phase_rad || 0) + elapsedSeconds * (orbit.angular_rate || 0.01) + forecastHours * 0.006;
}

export function orbitPosition(orbit, elapsedSeconds = 0, forecastHours = 0) {
  return orbitPositionTo(new THREE.Vector3(), orbit, elapsedSeconds, forecastHours);
}

export function orbitPositionTo(target, orbit, elapsedSeconds = 0, forecastHours = 0) {
  const radius = orbit.visual_radius || 4;
  const phase = orbitPhase(orbit, elapsedSeconds, forecastHours);
  const inclination = degToRad(orbit.inclination_deg || 0);
  const raan = degToRad(orbit.raan_deg || 0);

  target.set(Math.cos(phase) * radius, 0, Math.sin(phase) * radius);
  target.applyAxisAngle(ORBIT_X_AXIS, inclination);
  target.applyAxisAngle(ORBIT_Y_AXIS, raan);
  return target;
}

export function ringPoints(orbit, segments = 160) {
  const radius = orbit.visual_radius || 4;
  const inclination = degToRad(orbit.inclination_deg || 0);
  const raan = degToRad(orbit.raan_deg || 0);
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const phase = (i / segments) * Math.PI * 2;
    const vector = new THREE.Vector3(Math.cos(phase) * radius, 0, Math.sin(phase) * radius);
    vector.applyAxisAngle(ORBIT_X_AXIS, inclination);
    vector.applyAxisAngle(ORBIT_Y_AXIS, raan);
    points.push(vector);
  }
  return points;
}

export function riskRadius(altitudeKm) {
  if (altitudeKm <= 2000) return 2.22 + altitudeKm / 1850;
  if (altitudeKm <= 30000) return 3.55 + (altitudeKm - 2000) / 3400;
  return 11.75 + Math.min(5.5, (altitudeKm - 30000) / 2500);
}

export function riskColor(severity) {
  return RISK_COLORS[severity] || RISK_COLORS.low;
}

export function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}
