/**
 * riskClassifier.js
 *
 * In-browser inference for the ORION conjunction risk classification model.
 *
 * The model is a multinomial logistic-regression (softmax) classifier trained
 * offline on a physics-informed conjunction dataset — see
 * `scripts/train_risk_model.py`. Weights, feature order, the standardizer and
 * held-out metrics live in `riskModelWeights.json`, so inference here is a
 * pure, dependency-free forward pass (standardize -> linear -> softmax).
 *
 * It classifies each screened conjunction into Low / Medium / High / Critical
 * and returns calibrated class probabilities plus per-feature contributions
 * for explainability. Existing rule-based fields are never overwritten; the
 * model output is attached under `ml_*` keys.
 */

import model from "./riskModelWeights.json";

const { features: FEATURE_NAMES, classes: CLASSES, standardizer, coef, intercept } = model;

export const RISK_MODEL_INFO = {
  name: model.name,
  algorithm: model.algorithm,
  version: model.version,
  classes: CLASSES,
  features: FEATURE_NAMES,
  metrics: model.metrics,
};

const FEATURE_LABELS = {
  log_pc: "Collision probability",
  log_miss_distance: "Miss distance",
  relative_velocity: "Relative velocity",
  log_altitude: "Altitude regime",
  inclination_delta: "Inclination difference",
  debris_involvement: "Debris involvement",
  debris_density: "Local debris density",
  hours_to_tca: "Time to TCA",
  covariance_spread: "State uncertainty",
};

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isDebrisLike(object) {
  const category = String(object?.category || object?.object_type || "").toLowerCase();
  return category.includes("debris") || category.includes("fragment") || category.includes("rocket");
}

/**
 * Build the model feature vector (in trained order) from a conjunction event.
 */
export function extractFeatures(event) {
  const a = event?.primary || event?.obj_a || {};
  const b = event?.secondary || event?.obj_b || {};

  const pc = clamp(num(event?.probability_of_collision ?? event?.pc, 1e-7), 1e-12, 1);
  const miss = clamp(num(event?.miss_distance_m, 1000), 1, 1e6);
  const relV = clamp(
    num(event?.relative_velocity_km_s, Math.abs(num(a.velocity_kms, 7) - num(b.velocity_kms, 7)) + 1),
    0.05,
    20,
  );
  const altitude = clamp(
    Math.min(num(a.altitude_km, 700), num(b.altitude_km, 700)),
    120,
    45000,
  );
  const incDelta = clamp(
    num(event?.features?.inclination_difference_deg, Math.abs(num(a.inclination_deg, 0) - num(b.inclination_deg, 0))),
    0,
    180,
  );
  const debris = (isDebrisLike(a) ? 1 : 0) + (isDebrisLike(b) ? 1 : 0);
  const density = clamp((num(a.debris_density, 0.2) + num(b.debris_density, 0.2)) / 2, 0, 1);

  const tcaMs = event?.tca ? Date.parse(event.tca) - Date.now() : NaN;
  const hours = clamp(Number.isFinite(tcaMs) ? tcaMs / 3_600_000 : 24, 0.25, 336);

  const covariance = clamp(num(event?.covariance?.intrack_m, 320), 5, 20000);

  return [
    Math.log10(pc),
    Math.log10(miss),
    relV,
    Math.log10(altitude),
    incDelta,
    debris,
    density,
    hours,
    Math.log10(covariance),
  ];
}

/**
 * Run the classifier on a single conjunction event.
 * @returns {{level: string, confidence: number, probabilities: Object, contributions: Array, features: Object}}
 */
export function classifyRisk(event) {
  const raw = extractFeatures(event);
  const z = raw.map((value, i) => (value - standardizer.mean[i]) / (standardizer.std[i] || 1));

  const logits = coef.map((row, c) => row.reduce((sum, w, i) => sum + w * z[i], intercept[c]));
  const max = Math.max(...logits);
  const exp = logits.map((v) => Math.exp(v - max));
  const total = exp.reduce((sum, v) => sum + v, 0);
  const probs = exp.map((v) => v / total);

  let best = 0;
  for (let i = 1; i < probs.length; i += 1) if (probs[i] > probs[best]) best = i;

  // Explainability: signed contribution of each feature to the winning class
  // logit, normalized to percentages of total absolute influence.
  const signed = coef[best].map((w, i) => w * z[i]);
  const magnitude = signed.reduce((sum, v) => sum + Math.abs(v), 0) || 1;
  const contributions = signed
    .map((value, i) => ({
      feature: FEATURE_LABELS[FEATURE_NAMES[i]] || FEATURE_NAMES[i],
      key: FEATURE_NAMES[i],
      contribution_pct: Math.round((Math.abs(value) / magnitude) * 1000) / 10,
      direction: value >= 0 ? "increases" : "decreases",
    }))
    .sort((x, y) => y.contribution_pct - x.contribution_pct);

  const probabilities = {};
  CLASSES.forEach((name, i) => {
    probabilities[name] = Math.round(probs[i] * 10000) / 10000;
  });

  const features = {};
  FEATURE_NAMES.forEach((name, i) => {
    features[name] = Math.round(raw[i] * 1000) / 1000;
  });

  return {
    level: CLASSES[best],
    confidence: Math.round(probs[best] * 1000) / 10,
    probabilities,
    contributions,
    features,
  };
}

/**
 * Attach model predictions to every event. Rule-based fields are preserved.
 */
export function classifyEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    const prediction = classifyRisk(event);
    const top = prediction.contributions.slice(0, 3);
    return {
      ...event,
      ml_risk_level: prediction.level,
      ml_confidence: prediction.confidence,
      ml_probabilities: prediction.probabilities,
      ml_contributors: top,
      ml_features: prediction.features,
      ml_explanation:
        `Model classifies this encounter as ${prediction.level.toUpperCase()} risk ` +
        `(${prediction.confidence}% confidence), driven mainly by ` +
        `${top.map((item) => `${item.feature.toLowerCase()} (${item.contribution_pct}%)`).join(", ")}.`,
    };
  });
}

/**
 * Distribution of predicted classes across a set of events.
 */
export function mlRiskDistribution(events) {
  const distribution = Object.fromEntries(CLASSES.map((name) => [name, 0]));
  for (const event of events || []) {
    const level = event.ml_risk_level;
    if (level in distribution) distribution[level] += 1;
  }
  return distribution;
}
