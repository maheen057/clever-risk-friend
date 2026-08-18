"""
Train the ORION conjunction risk classifier.

Generates a physics-informed synthetic conjunction dataset, trains a
multinomial logistic-regression classifier (standardized features), and
exports the learned parameters to src/ssa/ml/riskModelWeights.json so the
browser can run inference with no backend.

Run:  python3 scripts/train_risk_model.py
"""

import json
import os
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix

RNG = np.random.default_rng(20260818)
N = 80_000

FEATURES = [
    "log_pc",                 # log10 probability of collision
    "log_miss_distance",      # log10 miss distance (m)
    "relative_velocity",      # km/s
    "log_altitude",           # log10 min altitude (km)
    "inclination_delta",      # deg
    "debris_involvement",     # 0..2 debris objects in the pair
    "debris_density",         # mean local density 0..1
    "hours_to_tca",           # hours
    "covariance_spread",      # 1-sigma in-track uncertainty (m)
]
CLASSES = ["Low", "Medium", "High", "Critical"]


def make_dataset(n):
    log_pc = RNG.uniform(-9.0, -2.5, n)
    log_miss = RNG.uniform(1.7, 4.6, n)          # 50 m .. 40 km
    rel_v = np.abs(RNG.normal(9.0, 4.0, n)) + 0.2
    alt = np.exp(RNG.uniform(np.log(300), np.log(36000), n))
    log_alt = np.log10(alt)
    inc_delta = np.abs(RNG.normal(0, 45, n)) % 180
    debris = RNG.choice([0, 1, 2], n, p=[0.25, 0.5, 0.25])
    density = np.clip(RNG.beta(2, 5, n) + (alt < 1200) * 0.15, 0, 1)
    hours = RNG.uniform(0.5, 168, n)
    cov = np.exp(RNG.uniform(np.log(20), np.log(2500), n))

    # Latent severity: dominated by Pc and miss distance, modulated by
    # closing speed, congestion, uncertainty and time available to react.
    severity = (
        1.55 * (log_pc + 6.0)
        - 1.20 * (log_miss - 3.0)
        + 0.10 * (rel_v - 8.0)
        - 0.35 * (log_alt - 3.0)
        + 0.006 * (inc_delta - 45.0)
        + 0.45 * (debris - 1.0)
        + 1.10 * (density - 0.3)
        - 0.010 * (hours - 48.0)
        + 0.55 * (np.log10(cov) - 2.3)
        + RNG.normal(0, 0.45, n)  # label noise: real screening is uncertain
    )

    y = np.digitize(severity, [-1.0, 0.6, 2.1])  # -> 0..3
    X = np.column_stack(
        [log_pc, log_miss, rel_v, log_alt, inc_delta, debris, density, hours, np.log10(cov)]
    )
    return X, y


X, y = make_dataset(N)
mean, std = X.mean(axis=0), X.std(axis=0)
Xs = (X - mean) / std

Xtr, Xte, ytr, yte = train_test_split(Xs, y, test_size=0.2, random_state=7, stratify=y)
clf = LogisticRegression(max_iter=3000, C=1.0, multi_class="multinomial")
clf.fit(Xtr, ytr)

pred = clf.predict(Xte)
metrics = {
    "accuracy": round(float(accuracy_score(yte, pred)), 4),
    "macro_f1": round(float(f1_score(yte, pred, average="macro")), 4),
    "confusion_matrix": confusion_matrix(yte, pred).tolist(),
    "train_samples": int(len(ytr)),
    "test_samples": int(len(yte)),
    "class_support": {CLASSES[i]: int((y == i).sum()) for i in range(4)},
}

model = {
    "name": "ORION Conjunction Risk Classifier",
    "algorithm": "Multinomial logistic regression (softmax), L2 regularized",
    "version": "1.0.0",
    "features": FEATURES,
    "classes": CLASSES,
    "standardizer": {"mean": [round(v, 6) for v in mean], "std": [round(v, 6) for v in std]},
    "coef": [[round(v, 6) for v in row] for row in clf.coef_],
    "intercept": [round(v, 6) for v in clf.intercept_],
    "metrics": metrics,
}

out = os.path.join(os.path.dirname(__file__), "..", "src", "ssa", "ml", "riskModelWeights.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(model, f, indent=2)

print(json.dumps(metrics, indent=2))
print("written:", os.path.normpath(out))
