import { Download } from "lucide-react";
import { motion } from "framer-motion";
import { BrainCircuit, Crosshair, Gauge, Orbit, Satellite, ShieldAlert, TrendingUp } from "lucide-react";
import { formatNumber, percent } from "../../utils/orbitalMath";
import { getObjectTypeLabel } from "../../utils/objectClassification";
import { buildCanonicalIdentity, resolveById, OBJECT_TYPE } from "../../utils/identityModel";

export function AnalyticsPanel({ object, risk, snapshot, activeFrame, onDownloadReport }) {
  // Use canonical identity model for consistent display
  // This ensures the AnalyticsPanel shows the SAME type/classification as
  // Collision Analysis, EventList, ObjectPair, and the Globe.
  const canonicalIdentity = object ? buildCanonicalIdentity(object) : null;
  const resolvedType = canonicalIdentity ? canonicalIdentity.displayType : getObjectTypeLabel(object);
  const resolvedId = canonicalIdentity ? canonicalIdentity.id : (object?.id || "");
  const resolvedName = canonicalIdentity ? canonicalIdentity.name : (object?.name || "UNKNOWN");

  // Cross-verify the object against the catalog (if available)
  // This catches cases where the object was passed with wrong identity
  // We use the catalog identity as authoritative if it differs from locally inferred type
  let finalType = resolvedType;
  let finalId = resolvedId;
  let finalName = resolvedName;
  if (object && snapshot?.objects && canonicalIdentity) {
    const catalogIdentity = resolveById(object.id, snapshot.objects, { suppressErrors: true });
    if (!catalogIdentity.unresolved && catalogIdentity.objectType !== canonicalIdentity.objectType) {
      console.warn(
        `[AnalyticsPanel] TYPE MISMATCH for ID ${object.id}: ` +
        `displayed type "${canonicalIdentity.displayType}" differs from catalog "${catalogIdentity.displayType}". ` +
        `Using catalog type for consistency.`
      );
      finalType = catalogIdentity.displayType;
      finalId = catalogIdentity.id;
      finalName = catalogIdentity.name;
    }
  }

  if (object) {
    const objectType = finalType;
    return (
      <motion.aside className="glass-panel analytics-panel" initial={{ x: 22, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 22, opacity: 0 }}>
        <PanelTitle icon={<Satellite size={18} />} eyebrow={`${objectType} | ${finalId}`} title={finalName} />
        <div className="analytics-grid">
          <Readout label="Object Type" value={objectType} />
          <Readout label="Orbit Type" value={object.orbit_type} />
          <Readout label="Band" value={object.band} />
          <Readout label="Altitude" value={`${formatNumber(object.altitude_km, 1)} km`} />
          <Readout label="Inclination" value={`${formatNumber(object.inclination_deg, 1)} deg`} />
          <Readout label="Velocity" value={`${formatNumber(object.velocity_kms, 2)} km/s`} />
          <Readout label="Debris Density" value={percent(object.debris_density)} />
          <Readout label="Collision Probability" value={percent(object.collision_probability)} tone="risk" />
          <Readout label="Predicted Future Risk" value={percent(object.future_risk)} tone="risk" />
        </div>
        <AiBlock
          text={`${object.name} (${objectType}) is operating in a ${object.band} traffic layer with ${percent(object.debris_density)} local debris density. Risk is shaped by crossing geometry, orbital shell crowding, and untracked particle uncertainty.`}
        />
        {onDownloadReport ? (
          <button className="primary-action download-report-btn" type="button" onClick={onDownloadReport}>
            <Download size={16} /> Download Report
          </button>
        ) : null}
      </motion.aside>
    );
  }

  if (risk) {
    return (
      <motion.aside className="glass-panel analytics-panel" initial={{ x: 22, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 22, opacity: 0 }}>
        <PanelTitle icon={<ShieldAlert size={18} />} eyebrow="Risk Region" title={`${risk.band} ${risk.severity.toUpperCase()} Corridor`} />
        <div className="risk-badge-line">
          <span className={`risk-pill ${risk.severity}`}>{risk.severity}</span>
          <span>{formatNumber(risk.altitude_km)} km</span>
          <span>{formatNumber(risk.inclination_deg)} deg inc</span>
        </div>
        <div className="analytics-grid">
          <Readout label="Collision Field" value={percent(risk.probability)} tone="risk" />
          <Readout label="Tracked Density" value={percent(risk.density)} />
          <Readout label="Untracked Density" value={percent(risk.untracked_density)} />
          <Readout label="Forecast Growth" value={percent(risk.forecast_delta)} tone="risk" />
          <Readout label="Uncertainty" value={percent(risk.uncertainty)} />
          <Readout label="RAAN" value={`${formatNumber(risk.raan_deg, 1)} deg`} />
        </div>
        <div className="contributor-list">
          <div className="section-label">
            <Crosshair size={14} />
            <span>Contributing Objects</span>
          </div>
          {risk.contributors?.slice(0, 4).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <AiBlock text={risk.explanation} />
      </motion.aside>
    );
  }

  const stats = snapshot?.stats || {};
  return (
    <motion.aside className="glass-panel analytics-panel" initial={{ x: 22, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 22, opacity: 0 }}>
      <PanelTitle icon={<Orbit size={18} />} eyebrow="Orbital Picture" title="Global Risk Field" />
      <div className="large-risk-readout">
        <span>{percent(activeFrame?.global_risk ?? stats.global_risk)}</span>
        <p>mean priority corridor risk</p>
      </div>
      <div className="analytics-grid">
        <Readout label="Tracked Objects" value={formatNumber(stats.tracked_objects)} />
        <Readout label="Active Satellites" value={formatNumber(stats.active_satellites)} />
        <Readout label="Debris Objects" value={formatNumber(stats.debris_objects)} />
        <Readout label="Forecast Trend" value={percent(stats.forecast_trend)} tone="risk" />
      </div>
      <AiBlock text="Risk is concentrated where high-density LEO shells intersect polar traffic, legacy fragmentation clouds, and forecasted congestion growth. Untracked debris fields are represented as probabilistic particle plumes around the highest-pressure orbital corridors." />
    </motion.aside>
  );
}

function PanelTitle({ icon, eyebrow, title }) {
  return (
    <div className="panel-title">
      {icon}
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function Readout({ label, value, tone }) {
  return (
    <div className={`readout ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AiBlock({ text }) {
  return (
    <div className="ai-block">
      <div className="section-label">
        <BrainCircuit size={14} />
        <span>Explainable AI</span>
      </div>
      <p>{text}</p>
      <div className="confidence-strip">
        <Gauge size={14} />
        <span>model confidence</span>
        <strong>82%</strong>
      </div>
      <div className="confidence-strip">
        <TrendingUp size={14} />
        <span>forecast horizon</span>
        <strong>168h</strong>
      </div>
    </div>
  );
}
