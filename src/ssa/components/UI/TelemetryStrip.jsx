import { motion } from "framer-motion";
import { Activity, DatabaseZap, RadioTower, Waves } from "lucide-react";
import { formatNumber, percent } from "../../utils/orbitalMath";

export function TelemetryStrip({ pulse, snapshot, loading }) {
  const stats = snapshot?.stats || {};
  const messages = [
    `TLE SOURCE: ${snapshot?.source || "initializing"}`,
    `TRACKS: ${formatNumber(stats.tracked_objects)}`,
    `DEBRIS: ${formatNumber(stats.debris_objects)}`,
    `LEO PRESSURE: ${formatNumber(stats.leo)}`,
    `GLOBAL RISK: ${percent(stats.global_risk)}`,
    `LATENCY: ${formatNumber(stats.data_latency_seconds, 1)}s`,
  ];

  return (
    <aside className={`telemetry-strip ${loading ? "loading" : ""}`}>
      <div className="telemetry-icons">
        <Activity size={15} />
        <RadioTower size={15} />
        <DatabaseZap size={15} />
        <Waves size={15} />
      </div>
      <motion.div
        key={pulse}
        className="telemetry-feed"
        initial={{ opacity: 0.35, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {messages.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </motion.div>
    </aside>
  );
}

