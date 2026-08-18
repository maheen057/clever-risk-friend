import { createFallbackForecast, createFallbackSnapshot } from "../data/fallbackData";
import { fetchCelestrakSnapshot } from "../data/celestrak";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";
export const REPORT_BASE = API_BASE;

let liveSource = null;

export async function getCatalog({ forecastHours = 0, limit = 900, signal } = {}) {
  try {
    const params = new URLSearchParams({
      forecast_hours: String(Math.round(forecastHours)),
      limit: String(limit),
    });
    const response = await fetch(`${API_BASE}/api/catalog?${params}`, { signal });
    if (!response.ok) {
      throw new Error(`SSA API returned ${response.status}`);
    }
    const payload = await response.json();
    return normalizeSnapshot(payload);
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    // Backend unavailable: use live CelesTrak GP elements before synthetic data.
    try {
      const live = await fetchCelestrakSnapshot(forecastHours, { signal });
      if (live) {
        liveSource = live.source;
        return normalizeSnapshot(live);
      }
    } catch (liveError) {
      if (liveError.name === "AbortError") throw liveError;
    }
    return createFallbackSnapshot(forecastHours);
  }
}


export async function getForecast({ horizonHours = 168, steps = 9, signal } = {}) {
  try {
    const params = new URLSearchParams({
      horizon_hours: String(horizonHours),
      steps: String(steps),
    });
    const response = await fetch(`${API_BASE}/api/forecast?${params}`, { signal });
    if (!response.ok) {
      throw new Error(`SSA API returned ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    return createFallbackForecast(horizonHours, steps);
  }
}

export async function getSystemHealth({ signal } = {}) {
  return getStructured("/api/system-health", { signal }, { data: fallbackHealth() });
}

export async function getAnalytics({ signal } = {}) {
  return getStructured("/api/analytics", { signal }, { data: null });
}

export async function getConjunctions({ limit = 100, signal } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  const payload = await getStructured(`/api/conjunctions?${params}`, { signal }, { data: [] });
  return payload.data || [];
}

export async function getSmartFilter({ signal } = {}) {
  return getStructured("/api/smart-filter", { signal }, { data: null });
}

export async function getManeuver(eventId, { signal } = {}) {
  if (!eventId) return null;
  const payload = await getStructured(`/api/conjunctions/${encodeURIComponent(eventId)}/maneuver`, { signal }, { data: null });
  return payload.data;
}

export function reportUrl(path) {
  return `${API_BASE}${path}`;
}

export async function downloadReport(path, filename) {
  const response = await fetch(reportUrl(path));
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}`);
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

async function getStructured(path, { signal } = {}, fallback) {
  try {
    const response = await fetch(`${API_BASE}${path}`, { signal });
    if (!response.ok) {
      throw new Error(`SSA API returned ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    return fallback;
  }
}

function normalizeSnapshot(payload) {
  return {
    ...payload,
    objects: payload.objects || [],
    risk_cells: payload.risk_cells || payload.riskCells || [],
    stats: {
      tracked_objects: 0,
      active_satellites: 0,
      debris_objects: 0,
      leo: 0,
      meo: 0,
      geo: 0,
      global_risk: 0,
      forecast_trend: 0,
      data_latency_seconds: 0,
      ...(payload.stats || {}),
    },
  };
}

function fallbackHealth() {
  const live = Boolean(liveSource);
  return {
    backend: live ? "CelesTrak direct feed" : "offline fallback",
    dataset_loaded: true,
    dataset_source: live ? liveSource : "Synthetic fallback",
    objects_tracked: 0,
    conjunctions: 0,
    high_priority_events: 0,
    ai_status: live ? "live (CelesTrak)" : "fallback",
    version: live ? "celestrak-live" : "offline",
  };
}
