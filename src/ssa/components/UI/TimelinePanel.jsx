import { Pause, Play, TimerReset } from "lucide-react";
import { percent } from "../../utils/orbitalMath";

export function TimelinePanel({ forecastHours, setForecastHours, isPlaying, setIsPlaying, activeFrame }) {
  return (
    <aside className="glass-panel timeline-panel">
      <div className="timeline-actions">
        <button className="icon-button" type="button" aria-label={isPlaying ? "Pause forecast playback" : "Play forecast playback"} onClick={() => setIsPlaying((value) => !value)}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-button" type="button" aria-label="Reset forecast time" onClick={() => setForecastHours(0)}>
          <TimerReset size={16} />
        </button>
      </div>

      <div className="timeline-main">
        <div className="timeline-head">
          <span>Prediction Playback</span>
          <strong>T+{forecastHours}h</strong>
        </div>
        <input
          aria-label="Forecast timeline"
          type="range"
          min="0"
          max="168"
          step="3"
          value={forecastHours}
          onChange={(event) => setForecastHours(Number(event.target.value))}
          style={{ "--progress": `${(forecastHours / 168) * 100}%` }}
        />
      </div>

      <div className="forecast-chip">
        <span>corridor risk</span>
        <strong>{percent(activeFrame?.global_risk || 0)}</strong>
      </div>
    </aside>
  );
}

