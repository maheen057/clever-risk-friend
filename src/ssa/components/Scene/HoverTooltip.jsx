import { useEffect, useState } from "react";
import { subscribeHover } from "./hoverStore";
import { getObjectTypeLabel } from "../../utils/objectClassification";

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${(n * 100).toFixed(1)}%`;
}

function num(value, digits = 0, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(digits)}${suffix}`;
}

/**
 * DOM tooltip that follows the cursor and names the satellite / debris object
 * currently under the pointer. Rendered outside the R3F <Canvas> tree.
 */
export function HoverTooltip() {
  const [hover, setHover] = useState({ object: null, x: 0, y: 0 });

  useEffect(() => subscribeHover(setHover), []);

  const object = hover.object;
  if (!object) return null;

  const isDebris = object.category === "debris";
  const name = object.name || object.object_name || object.id || "UNKNOWN OBJECT";
  let typeLabel = isDebris ? "Debris" : "Active satellite";
  try {
    typeLabel = getObjectTypeLabel(object) || typeLabel;
  } catch {
    /* keep fallback label */
  }

  const rows = [
    ["NORAD / ID", object.norad_id || object.id || null],
    ["Orbit band", object.band || null],
    ["Altitude", num(object.altitude_km ?? object.orbit?.altitude_km, 0, " km")],
    ["Inclination", num(object.orbit?.inclination_deg, 1, "°")],
    ["Velocity", num(object.velocity_kms ?? object.orbit?.velocity_kms, 2, " km/s")],
    [isDebris ? "Debris density" : "Collision prob.", pct(isDebris ? object.debris_density : object.collision_probability)],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");

  // Keep the card inside the viewport.
  const offset = 18;
  const width = 268;
  const left =
    typeof window !== "undefined" && hover.x + offset + width > window.innerWidth
      ? Math.max(8, hover.x - offset - width)
      : hover.x + offset;
  const top =
    typeof window !== "undefined" ? Math.min(hover.y + offset, window.innerHeight - 190) : hover.y + offset;

  return (
    <div
      className="ssa-hover-tooltip"
      style={{ left: `${left}px`, top: `${Math.max(8, top)}px`, width: `${width}px` }}
      role="tooltip"
    >
      <div className="ssa-hover-tooltip__head">
        <span className={`ssa-hover-tooltip__dot ${isDebris ? "is-debris" : "is-active"}`} />
        <span className="ssa-hover-tooltip__name">{name}</span>
      </div>
      <div className="ssa-hover-tooltip__type">{typeLabel}</div>
      <dl className="ssa-hover-tooltip__grid">
        {rows.map(([label, value]) => (
          <div key={label} className="ssa-hover-tooltip__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="ssa-hover-tooltip__hint">Click to lock &amp; focus</div>
    </div>
  );
}
