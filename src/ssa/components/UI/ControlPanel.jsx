import { Boxes, CircleDot, Layers3, RadioTower, Satellite, ShieldAlert, Sparkles } from "lucide-react";
import { formatNumber, percent } from "../../utils/orbitalMath";

const filterGroups = [
  {
    title: "Objects",
    icon: Satellite,
    items: [
      ["active", "Active satellites"],
      ["debris", "Tracked debris"],
    ],
  },
  {
    title: "Orbital Bands",
    icon: Layers3,
    items: [
      ["LEO", "LEO"],
      ["MEO", "MEO"],
      ["GEO", "GEO"],
    ],
  },
  {
    title: "Risk Levels",
    icon: ShieldAlert,
    items: [
      ["low", "Low"],
      ["moderate", "Moderate"],
      ["elevated", "Elevated"],
      ["severe", "Severe"],
    ],
  },
];

export function ControlPanel({ filters, setFilters, stats }) {
  return (
    <aside className="glass-panel control-panel">
      <div className="panel-title">
        <RadioTower size={18} />
        <div>
          <p className="eyebrow">Data Fusion</p>
          <h2>Sensor Stack</h2>
        </div>
      </div>

      <div className="metric-grid">
        <Metric icon={<CircleDot size={16} />} label="LEO" value={formatNumber(stats.leo)} />
        <Metric icon={<Boxes size={16} />} label="MEO" value={formatNumber(stats.meo)} />
        <Metric icon={<Sparkles size={16} />} label="GEO" value={formatNumber(stats.geo)} />
        <Metric icon={<ShieldAlert size={16} />} label="Trend" value={percent(stats.forecast_trend)} />
      </div>

      {filterGroups.map((group) => {
        const Icon = group.icon;
        return (
          <div className="filter-group" key={group.title}>
            <div className="filter-heading">
              <Icon size={16} />
              <span>{group.title}</span>
            </div>
            <div className={group.title === "Risk Levels" ? "risk-toggle-grid" : "toggle-stack"}>
              {group.items.map(([key, label]) => (
                <label className={`toggle-row ${filters[key] ? "enabled" : ""}`} key={key}>
                  <input
                    type="checkbox"
                    checked={Boolean(filters[key])}
                    onChange={() =>
                      setFilters((current) => ({
                        ...current,
                        [key]: !current[key],
                      }))
                    }
                  />
                  <span className={`toggle-dot ${key}`} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="mini-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

