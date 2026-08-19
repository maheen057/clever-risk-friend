import "./ssa.css";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Cpu,
  Brain,
  DatabaseZap,
  Download,
  FileText,
  Filter,
  Gauge,
  Globe2,
  Home,
  LayoutDashboard,
  LineChart,
  Loader2,
  PanelRightOpen,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Rocket,
  Satellite,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadReport,
  getAnalytics,
  getCatalog,
  getConjunctions,
  getForecast,
  getManeuver,
  getSmartFilter,
  getSystemHealth,
} from "./api/ssaClient";
import { SSAScene } from "./components/Scene/SSAScene";
import { AnalyticsPanel } from "./components/UI/AnalyticsPanel";
import { ControlPanel } from "./components/UI/ControlPanel";
import { TelemetryStrip } from "./components/UI/TelemetryStrip";
import { TimelinePanel } from "./components/UI/TimelinePanel";
import { formatNumber, percent } from "./utils/orbitalMath";
import { classifyEvents, mlRiskDistribution, RISK_MODEL_INFO } from "./ml/riskClassifier";
import {
  getObjectTypeLabel,
  getObjectTypeKey,
  validateAndFilterEvents,
  makePairKey,
} from "./utils/objectClassification";
import {
  buildCanonicalIdentity,
  resolveObjectType,
  getDisplayType,
  getPairType,
  formatObjectIdentity,
  isSatelliteDebrisPair,
  resolveById,
  validateEventIdentities,
  computeOperationalPriority,
  getEventCategoryLabel,
  isPrimaryOperationalRisk,
  PAIR_PRIORITY_MULTIPLIER,
  PAIR_CATEGORY_LABEL,
  OBJECT_TYPE,
  OBJECT_TYPE_DISPLAY,
  PAIR_TYPE,
} from "./utils/identityModel";
import {
  LineChart as RechartsLineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const initialFilters = {
  active: true,
  debris: true,
  LEO: true,
  MEO: true,
  GEO: true,
  low: true,
  moderate: true,
  elevated: true,
  severe: true,
};

const NAV = [
  { id: "home", label: "Home", icon: Home },
  { id: "visualization", label: "Visualization", icon: Globe2 },
  { id: "smart", label: "Smart AI Filter", icon: Filter },
  { id: "collision", label: "Collision Analysis", icon: Radar },
  { id: "maneuver", label: "Maneuver", icon: Rocket },
  { id: "analytics", label: "Historical Analytics", icon: BarChart3 },
  { id: "reports", label: "Reports", icon: FileText },
];

const RISK_CLASS = {
  Critical: "critical",
  High: "high",
  Medium: "medium",
  Low: "low",
  Safe: "safe",
};

export default function App() {
  const [activePage, setActivePage] = useState("home");
  const [snapshot, setSnapshot] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [platform, setPlatform] = useState({ health: null, analytics: null, conjunctions: [], smart: null });
  const [filters, setFilters] = useState(initialFilters);
  const [forecastHours, setForecastHours] = useState(24);
  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedObject, setSelectedObject] = useState(null);
  const [selectedRisk, setSelectedRisk] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [pendingFocusId, setPendingFocusId] = useState(null);
  const [pendingEventId, setPendingEventId] = useState(null);
  const [maneuver, setManeuver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notices, setNotices] = useState([]);
  const [watchlist, setWatchlist] = useState(() => new Set(JSON.parse(localStorage.getItem("ssa-watchlist") || "[]")));
  
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const [catalog, forecastPayload] = await Promise.all([
          getCatalog({ forecastHours, signal: controller.signal }),
          getForecast({ horizonHours: 168, steps: 9, signal: controller.signal }),
        ]);
        const [healthPayload, analyticsPayload, conjunctionPayload, smartPayload] = await Promise.all([
          getSystemHealth({ signal: controller.signal }),
          getAnalytics({ signal: controller.signal }),
          getConjunctions({ limit: 120, signal: controller.signal }),
          getSmartFilter({ signal: controller.signal }),
        ]);
        if (cancelled) return;
        const rawEvents = conjunctionPayload.length ? conjunctionPayload : buildLocalConjunctions(catalog);
        // Validate and filter events: remove self-pairs, duplicate pairs, etc.
        const validatedEvents = validateAndFilterEvents(rawEvents);
        // Apply type-aware operational prioritization
        // ML risk classification: attaches ml_risk_level / ml_confidence /
        // ml_probabilities / ml_contributors to every screened event.
        const localEvents = classifyEvents(applyOperationalPrioritization(validatedEvents));
        // Log pair type distribution for verification
        logPairTypeDistribution(localEvents);
        setSnapshot(catalog);
        setForecast(forecastPayload);
        setPlatform({
          health: healthPayload?.data || healthPayload,
          analytics: analyticsPayload?.data || buildLocalAnalytics(catalog, localEvents),
          conjunctions: localEvents,
          smart: smartPayload?.data || buildLocalSmart(localEvents, catalog?.stats?.tracked_objects || 0),
        });
        setSelectedEvent((current) => {
          if (current && localEvents.some((e) => e.id === current.id)) return current;
          return localEvents[0] || null;
        });
        setLoading(false);
        setPulse((value) => value + 1);
      } catch (error) {
        if (!cancelled && error.name !== "AbortError") {
          setLoading(false);
          pushNotice(setNotices, "Data refresh failed; using cached mission state.", "warning");
        }
      }
    }

    load();
    const refresh = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(refresh);
    };
  }, [reloadNonce]);

  useEffect(() => {
    if (!snapshot) return undefined;
    const controller = new AbortController();
    getCatalog({ forecastHours, signal: controller.signal }).then(setSnapshot).catch(() => {});
    return () => controller.abort();
  }, [forecastHours]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setInterval(() => {
      setForecastHours((value) => (value >= 168 ? 0 : value + 3));
    }, 1400);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  useEffect(() => {
    if (!selectedEvent?.id) return undefined;
    const controller = new AbortController();
    
    async function fetchManeuver() {
      try {
        const result = await getManeuver(selectedEvent.id, { signal: controller.signal });
        if (result && result.delta_v_m_s !== undefined) {
          // Backend returned valid maneuver data
          setManeuver(result);
        } else if (selectedEvent.primary && selectedEvent.secondary) {
          // Backend returned null/empty - compute local fallback maneuver
          console.info(`[Maneuver] Computing local fallback for event ${selectedEvent.id}`);
          setManeuver(computeLocalManeuver(selectedEvent));
        } else {
          setManeuver(null);
        }
      } catch {
        // API call failed - compute local fallback
        if (selectedEvent.primary && selectedEvent.secondary) {
          console.info(`[Maneuver] API failed, computing local fallback for ${selectedEvent.id}`);
          setManeuver(computeLocalManeuver(selectedEvent));
        } else {
          setManeuver(null);
        }
      }
    }
    
    fetchManeuver();
    return () => controller.abort();
  }, [selectedEvent]);

  const activeFrame = useMemo(() => {
    if (!forecast?.frames?.length) return null;
    return forecast.frames.reduce((closest, frame) => {
      return Math.abs(frame.hour - forecastHours) < Math.abs(closest.hour - forecastHours) ? frame : closest;
    }, forecast.frames[0]);
  }, [forecast, forecastHours]);

  const smartSnapshot = useMemo(() => buildSmartSnapshot(snapshot, platform.conjunctions), [snapshot, platform.conjunctions]);
  const topEvent = selectedEvent || platform.conjunctions[0] || null;
  const highPriority = platform.conjunctions.filter((event) => ["Critical", "High"].includes(event.risk_level));

  function navigate(page) {
    setActivePage(page);
    setNotificationsOpen(false);
  }

  function selectEvent(event, page = "collision") {
    setSelectedEvent(event);
    setActivePage(page);
  }

  function handleShowInGlobe(objectId, eventId) {
    setPendingFocusId(objectId);
    setPendingEventId(eventId);
    setActivePage("visualization");
  }

  function toggleWatchlist(objectId) {
    setWatchlist((current) => {
      const next = new Set(current);
      if (next.has(objectId)) next.delete(objectId);
      else next.add(objectId);
      localStorage.setItem("ssa-watchlist", JSON.stringify([...next]));
      return next;
    });
  }

  async function handleDownload(path, filename) {
    try {
      await downloadReport(path, filename);
      pushNotice(setNotices, `${filename} downloaded.`, "success");
    } catch {
      pushNotice(setNotices, "Download failed. Check that the FastAPI backend is running.", "warning");
    }
  }

  return (
    <div className="platform-shell">
      <Sidebar activePage={activePage} navigate={navigate} health={platform.health} />
      <div className="platform-main">
        <TopBar
          refresh={() => setReloadNonce((value) => value + 1)}
          loading={loading}
          notificationsOpen={notificationsOpen}
          setNotificationsOpen={setNotificationsOpen}
          notices={notices}
          health={platform.health}
        />
        <main className="content-main">
          {activePage === "home" ? (
            <HomePage snapshot={snapshot} platform={platform} highPriority={highPriority} navigate={navigate} selectEvent={selectEvent} />
          ) : null}
          {activePage === "visualization" ? (
            <VisualizationPage
              snapshot={snapshot}
              filters={filters}
              setFilters={setFilters}
              forecastHours={forecastHours}
              setForecastHours={setForecastHours}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              activeFrame={activeFrame}
              selectedObject={selectedObject}
              setSelectedObject={setSelectedObject}
              selectedRisk={selectedRisk}
              setSelectedRisk={setSelectedRisk}
              analyticsOpen={analyticsOpen}
              setAnalyticsOpen={setAnalyticsOpen}
              pulse={pulse}
              loading={loading}
              pendingFocusId={pendingFocusId}
              pendingEventId={pendingEventId}
              onClearPendingFocus={() => { setPendingFocusId(null); setPendingEventId(null); }}
              events={platform.conjunctions}
              download={handleDownload}
            />
          ) : null}
          {activePage === "smart" ? (
            <SmartFilterPage snapshot={snapshot} smartSnapshot={smartSnapshot} platform={platform} selectEvent={selectEvent} navigate={navigate} />
          ) : null}
          {activePage === "collision" ? (
            <CollisionPage
              event={topEvent}
              events={platform.conjunctions}
              selectEvent={selectEvent}
              toggleWatchlist={toggleWatchlist}
              watchlist={watchlist}
              download={handleDownload}
              onShowInGlobe={handleShowInGlobe}
            />
          ) : null}
          {activePage === "maneuver" ? <ManeuverPage event={topEvent} maneuver={maneuver} download={handleDownload} /> : null}
          {activePage === "analytics" ? <AnalyticsPage analytics={platform.analytics} events={platform.conjunctions} snapshot={snapshot} /> : null}
          {activePage === "reports" ? <ReportsPage event={topEvent} events={platform.conjunctions} download={handleDownload} smart={platform.smart} /> : null}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ activePage, navigate, health }) {
  return (
    <aside className="sidebar">
      <button className="brand-lockup" type="button" onClick={() => navigate("home")}>
        <span className="brand-mark"><Radar size={22} /></span>
        <span>
          <strong>ORION SSA</strong>
          <small>Risk Intelligence</small>
        </span>
      </button>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button key={item.id} className={`nav-item ${activePage === item.id ? "active" : ""}`} type="button" onClick={() => navigate(item.id)}>
            <item.icon size={17} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-status">
        <div><Activity size={14} /><span>AI Engine</span><strong>{health?.ai_status || "ready"}</strong></div>
        <div><DatabaseZap size={14} /><span>Dataset</span><strong>{health?.dataset_source || "TLE"}</strong></div>
      </div>
    </aside>
  );
}

function TopBar({ refresh, loading, notificationsOpen, setNotificationsOpen, notices, health }) {
  const [utc, setUtc] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setUtc(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <header className="topbar">
      <div className="topbar-meta">
        <span className="mono">{utc.toISOString().replace("T", " ").slice(0, 19)}Z</span>
        <span className="system-chip"><CheckCircle2 size={14} /> {health?.dataset_loaded ? "Dataset loaded" : "Loading dataset"}</span>
        <button className="icon-button" type="button" aria-label="Refresh orbital data" onClick={refresh}>
          {loading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
        </button>

      </div>
    </header>
  );
}



function HomePage({ snapshot, platform, highPriority, navigate, selectEvent }) {
  const stats = snapshot?.stats || {};
  const briefing = platform?.smart?.briefing || "Analyzing orbital environment and preparing mission briefing.";
  const analytics = platform?.analytics || {};

  return (
    <div className="page-stack">    
      <section className="home-hero">
        <div>
          <p className="eyebrow">AI-Powered Orbital Risk Intelligence Platform</p>
          <h1>Identifying the event that needs attention, explaining why and moving to action.</h1>
          <p>
            ORION fuses TLE propagation, orbital risk heatmaps, Foster 2D probability, explainable Smart Filter triage,
            maneuver planning, and professional reporting into one SSA workflow.
          </p>
          <div className="hero-actions">
            <button className="secondary-action" type="button" onClick={() => navigate("visualization")}>Open Visualization</button>
            <button className="secondary-action" type="button" onClick={() => navigate("smart")}>Explore AI</button>
          </div>
        </div>
        <div className="hero-briefing">
          <span><ShieldCheck size={18} /> AI Mission Briefing</span>
          <p>{briefing}</p>
        </div>
      </section>

     
        <KpiGrid stats={stats} analytics={analytics} smart={platform?.smart} />
        <section className="split-grid">
          <Panel title="Live Alerts" icon={AlertTriangle}>
            <EventList events={highPriority?.slice(0, 8) || []} onSelect={selectEvent} />
          </Panel>
          <Panel title="Risk Distribution" icon={Gauge}>
             <BarList data={analytics.risk_distribution || {}} total={analytics.total_conjunctions || 1} />
              </Panel>
        </section>
      
    </div>
  );
}


function VisualizationPage(props) {
  const {
    snapshot,
    filters,
    setFilters,
    forecastHours,
    setForecastHours,
    isPlaying,
    setIsPlaying,
    activeFrame,
    selectedObject,
    setSelectedObject,
    selectedRisk,
    setSelectedRisk,
    analyticsOpen,
    setAnalyticsOpen,
    pulse,
    loading,
    pendingFocusId,
    pendingEventId,
    onClearPendingFocus,
    events,
    download,
  } = props;
  const stats = snapshot?.stats || {};

  // Track auto-focus triggers for Show in Globe navigation
  const [focusKey, setFocusKey] = useState(0);

  // Store event context locally so it persists after pendingEventId is cleared
  const [localEventId, setLocalEventId] = useState(null);

  // Consume pendingFocusId: auto-select the object and focus on it
  useEffect(() => {
    if (!pendingFocusId || !snapshot?.objects) return;
    const match = snapshot.objects.find((obj) => obj.id === pendingFocusId);
    if (match) {
      setSelectedObject(match);
      setSelectedRisk(null);
      setAnalyticsOpen(true);
      // Capture the event ID locally before it gets cleared
      if (pendingEventId) {
        setLocalEventId(pendingEventId);
      }
      // Trigger camera focus
      setFocusKey((k) => k + 1);
    }
    onClearPendingFocus();
  }, [pendingFocusId, snapshot]);

  // Find the collision event associated with the captured event ID
  const pendingEvent = useMemo(() => {
    if (!localEventId || !events?.length) return null;
    return events.find((evt) => evt.id === localEventId) || null;
  }, [localEventId, events]);

  return (
    <div className="mission-scene-shell">
      <SSAScene
        snapshot={snapshot}
        filters={filters}
        forecastHours={forecastHours}
        activeFrame={activeFrame}
        selectedObject={selectedObject}
        selectedRisk={selectedRisk}
        focusKey={focusKey}
        onSelectObject={(object) => {
          setSelectedObject(object);
          setSelectedRisk(null);
          setAnalyticsOpen(true);
        }}
        onSelectRisk={(risk) => {
          setSelectedRisk(risk);
          setSelectedObject(null);
          setAnalyticsOpen(true);
        }}
      />
      <div className="hud-layer">
        <motion.header className="top-command-bar" initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="brand-block">
            <div className="brand-mark"><Radar size={22} /></div>
            <div><p className="eyebrow">Orbital Environment</p><h1>Visualization</h1></div>
          </div>
          <div className="status-cluster">
            <StatusMetric icon={<Satellite size={16} />} label="Tracked" value={stats.tracked_objects || 0} />
            <StatusMetric icon={<ShieldAlert size={16} />} label="Global Risk" value={percent(stats.global_risk)} accent="risk" />
            <StatusMetric icon={<DatabaseZap size={16} />} label="Feed" value={snapshot?.source?.includes("CelesTrak") ? "Live" : "Sim"} />
            <button className="icon-button" type="button" aria-label="Open analytics panel" onClick={() => setAnalyticsOpen(true)}><PanelRightOpen size={17} /></button>
          </div>
        </motion.header>
        <section className="left-rail"><ControlPanel filters={filters} setFilters={setFilters} stats={stats} /></section>
        <section className={`right-rail ${analyticsOpen ? "" : "rail-closed"}`}>
          {analyticsOpen ? (
            <AnalyticsPanel
              object={selectedObject}
              risk={selectedRisk}
              snapshot={snapshot}
              activeFrame={activeFrame}
              onClose={() => {
                if (selectedObject || selectedRisk) {
                  setSelectedObject(null);
                  setSelectedRisk(null);
                } else {
                  setAnalyticsOpen(false);
                }
              }}
              onDownloadReport={pendingEvent && download ? () => download(`/api/reports/${pendingEvent.id}.pdf`, `${pendingEvent.id}-report.pdf`) : null}
            />
          ) : null}
        </section>
        <section className="bottom-rail">
          <TimelinePanel
            forecastHours={forecastHours}
            setForecastHours={setForecastHours}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            activeFrame={activeFrame}
          />
          <TelemetryStrip pulse={pulse} snapshot={snapshot} loading={loading} />
        </section>
        <div className="floating-actions">
          <button className="round-action" type="button" onClick={() => setIsPlaying((value) => !value)}>{isPlaying ? <Pause size={18} /> : <Play size={18} />}</button>
          <button className="round-action" type="button" onClick={() => document.querySelector(".left-rail")?.classList.toggle("rail-open")}><SlidersHorizontal size={18} /></button>
        </div>
      </div>
    </div>
  );
}

function SmartFilterPage({ snapshot, smartSnapshot, platform, selectEvent, navigate }) {
  const smart = platform.smart || {};
  const raw = smart.raw_events || platform.conjunctions.length;
  const after = smart.after_filter || platform.conjunctions.filter((event) => ["High", "Critical", "Medium"].includes(event.risk_level)).length;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Flagship Feature"
        title="Smart AI Filter"
        text="Compare the raw orbital scene with the watchlist-only view produced by probability, covariance, confidence, and priority scoring."
        action={<button className="primary-action" type="button" onClick={() => navigate("collision")}>Review Events</button>}
      />
      <section className="before-after-grid">
        <SceneComparison title="Before AI" label="All tracked objects" count={raw} snapshot={snapshot} />
        <div className="reduction-column">
          <Filter size={28} />
          <strong>{Math.round(smart.reduction_pct || 0)}%</strong>
          <span>workload reduction</span>
        </div>
        <SceneComparison title="After AI" label="Watchlist + high risk only" count={after} snapshot={smartSnapshot} accent />
      </section>
      <section className="split-grid wide-left">
        <Panel title="Smart Filter Pipeline" icon={Cpu}>
          <Pipeline stages={smart.pipeline_stages || []} />
        </Panel>
        <Panel title="AI Confidence" icon={ShieldCheck}>
          <div className="confidence-readout">{Math.round(smart.avg_confidence_pct || 0)}%</div>
          <BarList data={smart.by_class || {}} total={raw || 1} />
        </Panel>
      </section>
      <Panel title="Explainable Predictions" icon={ClipboardList}>
        <EventList events={platform.conjunctions.slice(0, 8)} onSelect={selectEvent} detailed />
      </Panel>
    </div>
  );
}

function CollisionPage({ event, events, selectEvent, toggleWatchlist, watchlist, download, onShowInGlobe }) {
  if (!event) return <EmptyState title="No conjunctions detected" text="The current catalog did not produce candidate events." />;

  // Resolve canonical identities for display
  const pIdentity = buildCanonicalIdentity(event.primary);
  const sIdentity = buildCanonicalIdentity(event.secondary);
  const pairType = event.pair_type || getPairType(event.primary, event.secondary);

  // Build display strings
  const pDisplay = `${pIdentity.name} · ID: ${pIdentity.id}`;
  const sDisplay = `${sIdentity.name} · ID: ${sIdentity.id}`;
  const pTypeDisplay = pIdentity.displayType;
  const sTypeDisplay = sIdentity.displayType;

  const watched = watchlist.has(event.primary.id) || watchlist.has(event.secondary.id);
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Collision Analysis"
        title={`${pDisplay} vs ${sDisplay}`}
        text={`${pTypeDisplay} vs ${sTypeDisplay} — ${pairType}. Detailed conjunction review with Foster 2D probability, covariance, AI explanation, and decision support.`}
        action={<button className="primary-action" type="button" onClick={() => download(`/api/reports/${event.id}.pdf`, `${event.id}-report.pdf`)}>Download Event PDF</button>}
      />
      <section className="collision-layout">
        <Panel title="Prioritized Events" icon={Radar}>
          <EventList events={events.slice(0, 14)} onSelect={(item) => selectEvent(item, "collision")} compact />
        </Panel>
        <div className="detail-stack">
          <div className="event-hero">
            <RiskBadge risk={event.risk_level} />
            <strong>Priority {event.priority_score}/100</strong>
            <span>{event.suggested_action}</span>
          </div>
          <MetricRow
            metrics={[
              ["Foster 2D Pc", event.pc_scientific],
              ["Miss Distance", `${formatNumber(event.miss_distance_m, 1)} m`],
              ["Relative Velocity", `${event.relative_velocity_km_s} km/s`],
              ["AI Confidence", `${event.ai_confidence}%`],
            ]}
          />
          <section className="split-grid">
            <Panel title="Encounter Plane" icon={Target}>
              <CovarianceView covariance={event.covariance} />
            </Panel>
            <Panel title="AI Explanation" icon={Cpu}>
              <p className="briefing-text">{event.ai_explanation}</p>
              <FactorList factors={event.ai_contributors} />
            </Panel>
          </section>
          <section className="split-grid">
            <Panel title="ML Risk Classification" icon={Brain}>
              <MlRiskCard event={event} />
            </Panel>
          </section>
          <section className="split-grid">
            <Panel title="Object Information" icon={Satellite}>
              <ObjectPair event={event} toggleWatchlist={toggleWatchlist} watched={watched} onShowInGlobe={onShowInGlobe} />
            </Panel>
            <Panel title="Decision Support" icon={ShieldAlert}>
              <div className="action-plan">
                <span>{event.suggested_action}</span>
                <button className="primary-action" type="button" onClick={() => selectEvent(event, "maneuver")}>Open Maneuver Plan</button>
                <button className="secondary-action" type="button" onClick={() => downloadCsvFile(buildConjunctionsCsv(events), "conjunctions.csv")}>Download CSV</button>
              </div>
            </Panel>
          </section>
        </div>
      </section>
    </div>
  );
}

function ManeuverPage({ event, maneuver, download }) {
  if (!event) return <EmptyState title="No event selected" text="Select a conjunction before requesting an avoidance recommendation." />;
  const m = maneuver || {};
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Maneuver Recommendation"
        title="Avoidance Action Plan"
        text="Delta-V, burn timing, fuel cost, and before/after probability are computed from the selected conjunction state."
        action={<button className="primary-action" type="button" onClick={() => download(`/api/reports/${event.id}.pdf`, `${event.id}-action-plan.pdf`)}>Download Action Plan</button>}
      />
      <MetricRow
        metrics={[
          ["Delta-V", `${m.delta_v_m_s ?? "..."} m/s`],
          ["Burn Direction", m.burn_direction || "..."],
          ["Fuel Cost", `${m.fuel_cost_kg ?? "..."} kg`],
          ["Risk Reduction", `${m.risk_reduction_pct ?? "..."}%`],
        ]}
      />
      <section className="split-grid">
        <Panel title="Before / After" icon={Rocket}>
          <BeforeAfter event={event} maneuver={m} />
        </Panel>
        <Panel title="Burn Window" icon={Target}>
          <div className="readout-list">
            <span>Burn time UTC <strong>{m.burn_time_utc || "Calculating..."}</strong></span>
            <span>Pc before <strong>{scientific(m.probability_before)}</strong></span>
            <span>Pc after <strong>{scientific(m.probability_after)}</strong></span>
            <span>Mission impact <strong>{m.mission_impact || "Awaiting optimizer output"}</strong></span>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function AnalyticsPage({ analytics, events, snapshot }) {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Historical Analytics" title="Orbital Risk Trends" text="Distribution, congestion, event history, and prediction-confidence views generated from the processed catalog." />
      <section className="split-grid">
        <Panel title="Orbit Band Distribution" icon={BarChart3}>
          <BarList data={analytics?.band_distribution || {}} total={snapshot?.stats?.tracked_objects || 1} />
        </Panel>
        <Panel title="Risk Trend" icon={LineChart}>
          <TrendLine points={analytics?.risk_timeline || []} />
        </Panel>
      </section>
      <section className="split-grid">
        <Panel title="ML Risk Classification" icon={Brain}>
          <BarList data={mlRiskDistribution(events)} total={events.length || 1} />
          <span className="ml-model-note">
            {RISK_MODEL_INFO.name} v{RISK_MODEL_INFO.version} · {RISK_MODEL_INFO.features.length} features ·
            held-out accuracy {(RISK_MODEL_INFO.metrics.accuracy * 100).toFixed(1)}%
          </span>
        </Panel>
        <Panel title="Risk Matrix" icon={Gauge}>
          <RiskMatrix events={events} />
        </Panel>
        <Panel title="Top Event Scatter" icon={Target}>
          <Scatter events={events.slice(0, 24)} />
        </Panel>
      </section>
    </div>
  );
}

function ReportsPage({ event, events, download, smart }) {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Reports" title="Export Center" text="Generate professional deliverables directly from the backend report engine." />
      <section className="report-grid">
        <ReportCard title="Mission Report" text="Executive summary, analytics, top events, AI briefing, and decision support." onClick={() => download("/api/reports/mission.pdf", "orbital-mission-report.pdf")} icon={FileText} />
        <ReportCard title="Conjunction CSV" text="Tabular export for screened conjunction events and priority scores." onClick={() => downloadCsvFile(buildConjunctionsCsv(events), "conjunctions.csv")} icon={Download} />
        <ReportCard title="Mission JSON" text="Raw event, probability, covariance, Smart Filter, and metadata payload." onClick={() => download("/api/reports/mission.json", "orbital-mission-report.json")} icon={DatabaseZap} />
        <ReportCard title="Selected Event PDF" text={event ? `${event.id}: ${event.primary.name} vs ${event.secondary.name}` : "Select an event first."} onClick={() => event && download(`/api/reports/${event.id}.pdf`, `${event.id}-report.pdf`)} icon={ClipboardList} disabled={!event} />
      </section>
      <Panel title="Summary" icon={BookOpen}>
        <p className="briefing-text">{smart?.briefing}</p>
      </Panel>
    </div>
  );
}


function SceneComparison({ title, label, count, snapshot, accent }) {
  return (
    <div className={`scene-comparison ${accent ? "accent" : ""}`}>
      <div className="scene-comparison-head">
        <span>{title}</span>
        <strong>{formatNumber(count)}</strong>
      </div>
      <div className="mini-scene">
        <SSAScene
          snapshot={snapshot}
          filters={initialFilters}
          forecastHours={24}
          activeFrame={null}
          selectedObject={null}
          selectedRisk={null}
          onSelectObject={() => {}}
          onSelectRisk={() => {}}
        />
      </div>
      <small>{label}</small>
    </div>
  );
}

function KpiGrid({ stats, analytics, smart }) {
  const cards = [
    ["Objects Tracked", stats.tracked_objects, Satellite],
    ["Debris Count", stats.debris_objects, AlertTriangle],
    ["High Risk Events", analytics?.high_priority_events, ShieldAlert],
    ["Average Pc", analytics?.average_pc_scientific, Gauge],
    ["AI Confidence", `${Math.round(smart?.avg_confidence_pct || 0)}%`, Cpu],
    ["Smart Reduction", `${Math.round(smart?.reduction_pct || 0)}%`, Filter],
  ];
  return (
    <section className="kpi-grid">
      {cards.map(([label, value, Icon]) => (
        <div className="kpi-card" key={label}>
          <Icon size={18} />
          <span>{label}</span>
          <strong>{value ?? "..."}</strong>
          <small>Updated UTC</small>
        </div>
      ))}
    </section>
  );
}

function PageHeader({ eyebrow, title, text, action }) {
  return (
    <section className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {text ? <p>{text}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </section>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="panel">
      <div className="panel-heading"><Icon size={17} /><h2>{title}</h2></div>
      {children}
    </section>
  );
}

function StatusMetric({ icon, label, value, accent }) {
  return (
    <div className={`status-metric ${accent || ""}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EventList({ events, onSelect, detailed, compact }) {
  if (!events?.length) return <p className="muted">No prioritized events in the current dataset.</p>;
  return (
    <div className={`event-list ${compact ? "compact" : ""}`}>
      {events.map((event) => {
        // Resolve identities for display
        const pName = event.primary.canonicalName || event.primary.name;
        const pType = event.primary.canonicalType || getDisplayType(resolveObjectType(event.primary));
        const pId = event.primary.canonicalId || event.primary.id;

        const sName = event.secondary.canonicalName || event.secondary.name;
        const sType = event.secondary.canonicalType || getDisplayType(resolveObjectType(event.secondary));
        const sId = event.secondary.canonicalId || event.secondary.id;

        const pairType = event.pair_type || getPairType(event.primary, event.secondary);
        return (
          <button key={event.id} type="button" onClick={() => onSelect(event)} className="event-row">
            <RiskBadge risk={event.risk_level} />
            <span>
              <strong>{pName} · ID: {pId}</strong>
              <small>{sName} · ID: {sId} | Pc {event.pc_scientific}</small>
              <em>{pType} vs {sType}</em>
              {detailed ? <em>{event.ai_explanation}</em> : null}
            </span>
            <b>{event.priority_score}</b>
          </button>
        );
      })}
    </div>
  );
}

function RiskBadge({ risk }) {
  return <span className={`risk-badge ${RISK_CLASS[risk] || "low"}`}>{risk}</span>;
}

function MetricRow({ metrics }) {
  return (
    <section className="metric-row">
      {metrics.map(([label, value]) => (
        <div key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </section>
  );
}

function Pipeline({ stages }) {
  return (
    <div className="pipeline">
      {(stages.length ? stages : [{ name: "Raw Data", count: 0 }, { name: "Feature Engineering", count: 0 }, { name: "Foster Pc", count: 0 }, { name: "AI Classification", count: 0 }, { name: "Watchlist", count: 0 }, { name: "Action Plan", count: 0 }]).map((stage, index) => (
        <div key={`${stage.name}-${index}`}>
          <span>{index + 1}</span>
          <strong>{stage.name}</strong>
          <small>{stage.count ?? 0} records | {stage.kept_pct ?? 100}%</small>
        </div>
      ))}
    </div>
  );
}

function BarList({ data, total }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <p className="muted">Awaiting backend analytics.</p>;
  return (
    <div className="bar-list">
      {entries.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <i style={{ width: `${Math.max(4, (Number(value) / Math.max(1, total)) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function TrendLine({ points }) {

  const data = (points || []).map((point, index) => ({
    time: point.timestamp || `T${index + 1}`,
    risk: Number(point.global_risk ?? 0)
  }));

  return (
    <div style={{ width: "100%", height: 250 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart
          data={data}
          margin={{
            top: 10,
            right: 20,
            left: 0,
            bottom: 10
          }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#26364d"
          />

          <XAxis
            dataKey="time"
            stroke="#9fb7d9"
            tick={{ fontSize: 11 }}
          />

          <YAxis
            stroke="#9fb7d9"
            tick={{ fontSize: 11 }}
            domain={[0, 1]}
          />

          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #334155",
              color: "#fff"
            }}
          />

          <Line
            type="monotone"
            dataKey="risk"
            stroke="#38bdf8"
            strokeWidth={3}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CovarianceView({ covariance }) {
  return (
    <div className="covariance-view">
      <div className="ellipse"><span /></div>
      <div className="readout-list">
        <span>Radial <strong>{covariance.radial_m} m</strong></span>
        <span>In-track <strong>{covariance.intrack_m} m</strong></span>
        <span>Cross-track <strong>{covariance.crosstrack_m} m</strong></span>
      </div>
    </div>
  );
}

function FactorList({ factors }) {
  return (
    <div className="factor-list">
      {factors.map((factor) => (
        <span key={factor.feature}>{factor.feature.replaceAll("_", " ")} <strong>{factor.contribution_pct}%</strong></span>
      ))}
    </div>
  );
}

function MlRiskCard({ event }) {
  if (!event?.ml_risk_level) {
    return <p className="briefing-text">Model output unavailable for this event.</p>;
  }
  const probabilities = event.ml_probabilities || {};
  return (
    <div className="ml-risk-card">
      <div className="ml-risk-head">
        <RiskBadge risk={event.ml_risk_level} />
        <strong>{event.ml_confidence}% confidence</strong>
        <span>{RISK_MODEL_INFO.algorithm}</span>
      </div>
      <div className="ml-prob-list">
        {RISK_MODEL_INFO.classes.map((name) => {
          const value = Number(probabilities[name] || 0);
          return (
            <div className="ml-prob-row" key={name}>
              <span>{name}</span>
              <div className="ml-prob-track">
                <div className={`ml-prob-fill ${RISK_CLASS[name] || "low"}`} style={{ width: `${Math.round(value * 100)}%` }} />
              </div>
              <strong>{(value * 100).toFixed(1)}%</strong>
            </div>
          );
        })}
      </div>
      <p className="briefing-text">{event.ml_explanation}</p>
      <FactorList factors={event.ml_contributors || []} />
      <span className="ml-model-note">
        {RISK_MODEL_INFO.name} v{RISK_MODEL_INFO.version} · held-out accuracy {(RISK_MODEL_INFO.metrics.accuracy * 100).toFixed(1)}% ·
        macro F1 {RISK_MODEL_INFO.metrics.macro_f1.toFixed(2)} · {RISK_MODEL_INFO.metrics.train_samples.toLocaleString()} training samples
      </span>
    </div>
  );
}

function ObjectPair({ event, toggleWatchlist, watched, onShowInGlobe }) {
  // Use canonical identities for display
  const pIdentity = buildCanonicalIdentity(event.primary);
  const sIdentity = buildCanonicalIdentity(event.secondary);
  const pairType = event.pair_type || getPairType(event.primary, event.secondary);

  return (
    <div className="object-pair">
      <div>
        <strong>{pIdentity.name} · ID: {pIdentity.id}</strong>
        <span className="object-type-badge" data-type={pIdentity.objectType}>{pIdentity.displayType}</span>
        <span>{event.primary.band} | {event.primary.orbit_type}</span>
        <small>{event.primary.altitude_km} km | {event.primary.inclination_deg} deg | {event.primary.velocity_kms} km/s</small>
        <div className="object-actions">
          <button className="primary-action" type="button" onClick={() => onShowInGlobe(pIdentity.id, event.id)}>Show in Globe</button>
        </div>
      </div>
      <div>
        <strong>{sIdentity.name} · ID: {sIdentity.id}</strong>
        <span className="object-type-badge" data-type={sIdentity.objectType}>{sIdentity.displayType}</span>
        <span>{event.secondary.band} | {event.secondary.orbit_type}</span>
        <small>{event.secondary.altitude_km} km | {event.secondary.inclination_deg} deg | {event.secondary.velocity_kms} km/s</small>
        <div className="object-actions">
          <button className="primary-action" type="button" onClick={() => onShowInGlobe(sIdentity.id, event.id)}>Show in Globe</button>
        </div>
      </div>
    </div>
  );
}

function BeforeAfter({ event, maneuver }) {
  return (
    <div className="before-after">
      <div><span>Before</span><strong>{event.pc_scientific}</strong><small>{formatNumber(event.miss_distance_m, 1)} m miss</small></div>
      <ChevronRight size={24} />
      <div><span>After</span><strong>{scientific(maneuver.probability_after)}</strong><small>{formatNumber(maneuver.miss_distance_after_m, 1)} m miss</small></div>
    </div>
  );
}

function RiskMatrix({ events }) {
  // Continuous scientific heatmap (2D) derived only from existing event fields.
  // We bin events across altitude (x) and relative velocity (y), and compute mean risk.

  const [hover, setHover] = useState(null);

  const width = 520;
  const height = 260;
  const pad = { l: 52, r: 16, t: 18, b: 46 };

  const safeEvents = (events || []).filter(Boolean);

  // Extract numeric fields gracefully.
  const points = safeEvents
    .map((e) => {
      const alt = Number(e?.primary?.altitude_km ?? e?.obj_a?.altitude_km ?? e?.secondary?.altitude_km);
      const rv = Number(e?.relative_velocity_km_s ?? e?.obj_a?.relative_velocity_km_s ?? e?.relative_velocity_km_s);
      const prob = Number(e?.probability_of_collision ?? e?.pc ?? e?.pc_scientific ? Number.parseFloat(String(e.pc_scientific)) : e?.probability_of_collision);
      const risk = String(e?.risk_level || "low").toLowerCase();
      if (!Number.isFinite(alt) || !Number.isFinite(rv)) return null;
      return { e, alt, rv, prob: Number.isFinite(prob) ? prob : null, risk };
    })
    .filter(Boolean);

  // If missing fields, fall back to original block UI (avoid breaking scope).
  if (!points.length) {
    const cells = Array.from({ length: 25 }, (_, index) => index);
    return (
      <div className="risk-matrix">
        {cells.map((cell) => <span key={cell} className={(safeEvents[cell % Math.max(1, safeEvents.length)]?.risk_level || "low").toLowerCase()} />)}
      </div>
    );
  }

  const altMin = Math.min(...points.map((p) => p.alt));
  const altMax = Math.max(...points.map((p) => p.alt));
  const rvMin = Math.min(...points.map((p) => p.rv));
  const rvMax = Math.max(...points.map((p) => p.rv));

  // Use a fixed binning resolution for stable UI.
  const binsX = 22;
  const binsY = 12;

  const cellW = (width - pad.l - pad.r) / binsX;
  const cellH = (height - pad.t - pad.b) / binsY;

  const riskToScore = (risk) => {
    // Use ordered score so we can map to continuous color.
    // low < moderate < elevated < high < critical < extreme
    const r = risk;
    if (r === "low" || r === "safe") return 0.05;
    if (r === "moderate") return 0.25;
    if (r === "elevated") return 0.45;
    if (r === "high") return 0.7;
    if (r === "critical") return 0.9;
    // Not present in existing data most likely.
    return r === "extreme" ? 1.0 : 0.05;
  };

  const colorStops = [
    { at: 0.0, c: "#22c55e" }, // low
    { at: 0.25, c: "#38bdf8" }, // moderate
    { at: 0.45, c: "#ffd166" }, // elevated
    { at: 0.7, c: "#ff8a3d" }, // high
    { at: 0.9, c: "#ff2f55" }, // critical
    { at: 1.0, c: "#b91cff" }, // extreme
  ];

  const lerp = (a, b, t) => a + (b - a) * t;

  const hexToRgb = (hex) => {
    const h = hex.replace("#", "");
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  const rgbToCss = (r, g, b, a = 1) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

  const colorScale = (t) => {
    const x = Math.max(0, Math.min(1, t));
    for (let i = 0; i < colorStops.length - 1; i += 1) {
      const a = colorStops[i];
      const b = colorStops[i + 1];
      if (x >= a.at && x <= b.at) {
        const u = (x - a.at) / Math.max(1e-9, b.at - a.at);
        const ra = hexToRgb(a.c);
        const rb = hexToRgb(b.c);
        return rgbToCss(lerp(ra.r, rb.r, u), lerp(ra.g, rb.g, u), lerp(ra.b, rb.b, u), 0.92);
      }
    }
    const last = colorStops[colorStops.length - 1];
    const rl = hexToRgb(last.c);
    return rgbToCss(rl.r, rl.g, rl.b, 0.92);
  };

  // Bin aggregation: store sum of risk scores and count.
  const grid = Array.from({ length: binsY }, () => Array.from({ length: binsX }, () => ({ sum: 0, count: 0 })));

  for (const p of points) {
    const nx = (p.alt - altMin) / Math.max(1e-9, altMax - altMin);
    const ny = (p.rv - rvMin) / Math.max(1e-9, rvMax - rvMin);

    const ix = Math.max(0, Math.min(binsX - 1, Math.floor(nx * binsX)));
    const iy = Math.max(0, Math.min(binsY - 1, Math.floor(ny * binsY)));

    const score = riskToScore(p.risk);
    grid[iy][ix].sum += score;
    grid[iy][ix].count += 1;
  }

  const cells = [];
  for (let iy = 0; iy < binsY; iy += 1) {
    for (let ix = 0; ix < binsX; ix += 1) {
      const cell = grid[iy][ix];
      const has = cell.count > 0;
      const score = has ? cell.sum / cell.count : 0;

      // Determine representative values for hover (exact fields averaged only if available).
      // For mission dashboard: keep simple; we show exact-ish aggregated approximations.
      const xAlt = altMin + ((ix + 0.5) / binsX) * (altMax - altMin);
      const yRv = rvMin + ((iy + 0.5) / binsY) * (rvMax - rvMin);

      cells.push({ ix, iy, score, has, xAlt, yRv, count: cell.count });
    }
  }

  const riskBand = (score) => {
    if (score < 0.15) return "Low";
    if (score < 0.4) return "Moderate";
    if (score < 0.62) return "High";
    if (score < 0.82) return "Critical";
    return "Extreme";
  };

  const showHover = (evt, cell) => {
    if (!cell.has) {
      setHover(null);
      return;
    }
    const rect = evt.currentTarget.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    setHover({ cell, x, y });
  };

  const hideHover = () => setHover(null);

  return (
    <div className="heatmap-graph">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ color: "#38bdf8", fontWeight: 800, fontSize: 12, textTransform: "uppercase" }}>Orbital Risk Heatmap</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 750, textTransform: "uppercase" }}>Legend</span>
          <div style={{ width: 120, height: 10, border: "1px solid rgba(255,255,255,0.08)", background: `linear-gradient(90deg, ${colorScale(0)} 0%, ${colorScale(0.25)} 25%, ${colorScale(0.45)} 45%, ${colorScale(0.7)} 70%, ${colorScale(0.9)} 90%, ${colorScale(1)} 100%)` }} />
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", height: 290, border: "1px solid rgba(255,255,255,0.08)", background: "#02030a", borderRadius: 10, overflow: "hidden" }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={hideHover}>
          {/* grid lines */}
          {Array.from({ length: binsX + 1 }, (_, i) => (
            <line
              key={`gx-${i}`}
              x1={pad.l + i * cellW}
              y1={pad.t}
              x2={pad.l + i * cellW}
              y2={height - pad.b}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: binsY + 1 }, (_, i) => (
            <line
              key={`gy-${i}`}
              x1={pad.l}
              y1={pad.t + i * cellH}
              x2={width - pad.r}
              y2={pad.t + i * cellH}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          ))}

          {/* cells */}
          {cells.map((cell) => {
            const x = pad.l + cell.ix * cellW;
            const y = pad.t + (binsY - 1 - cell.iy) * cellH; // invert so higher RV is top
            const fill = cell.has ? colorScale(cell.score) : "rgba(255,255,255,0.03)";
            const stroke = cell.has ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)";
            const opacity = cell.has ? 0.95 : 1;

            return (
              <rect
                key={`c-${cell.ix}-${cell.iy}`}
                x={x}
                y={y}
                width={cellW}
                height={cellH}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
                opacity={opacity}
                onMouseMove={(e) => showHover(e, cell)}
              />
            );
          })}

          {/* axes ticks */}
          {Array.from({ length: 5 }, (_, i) => {
            const t = i / 4;
            const x = pad.l + t * (width - pad.l - pad.r);
            const alt = altMin + t * (altMax - altMin);
            return (
              <g key={`xt-${i}`}>
                <line x1={x} y1={height - pad.b} x2={x} y2={height - pad.b + 6} stroke="rgba(255,255,255,0.12)" />
                <text x={x} y={height - pad.b + 22} fill="#9fb7d9" fontSize="10" textAnchor="middle">{Math.round(alt)} km</text>
              </g>
            );
          })}

          {Array.from({ length: 5 }, (_, i) => {
            const t = i / 4;
            const y = pad.t + (binsY - 1 - t * (binsY - 1)) * cellH;
            const rv = rvMin + t * (rvMax - rvMin);
            return (
              <g key={`yt-${i}`}>
                <line x1={pad.l - 6} y1={y} x2={pad.l} y2={y} stroke="rgba(255,255,255,0.12)" />
                <text x={pad.l - 10} y={y + 3} fill="#9fb7d9" fontSize="10" textAnchor="end">{rv.toFixed(1)} km/s</text>
              </g>
            );
          })}

          <text x={(pad.l + width - pad.r) / 2} y={height - 8} fill="#94a3b8" fontSize="11" textAnchor="middle" fontWeight="700">Orbital altitude (km)</text>
          <text transform={`rotate(-90 ${18} ${(pad.t + height - pad.b) / 2})`} x={18} y={(pad.t + height - pad.b) / 2} fill="#94a3b8" fontSize="11" textAnchor="middle" fontWeight="700">Relative velocity (km/s)</text>
        </svg>

        {hover?.cell ? (
          <div
            className="heatmap-tooltip"
            style={{
              position: "absolute",
              left: Math.min(520 - 220, Math.max(6, hover.x)),
              top: Math.min(290 - 140, Math.max(6, hover.y)),
              width: 220,
              pointerEvents: "none",
              border: "1px solid rgba(129,225,255,0.22)",
              background: "linear-gradient(180deg, rgba(14,28,46,0.88), rgba(5,9,18,0.72))",
              borderRadius: 12,
              padding: 12,
              boxShadow: "0 18px 50px rgba(0,0,0,0.4)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: 999, background: colorScale(hover.cell.score), boxShadow: `0 0 18px ${colorScale(hover.cell.score)}` }} />
              <div style={{ fontWeight: 900, color: "#fff", fontSize: 13 }}>{riskBand(hover.cell.score)} risk region</div>
            </div>

            <div style={{ display: "grid", gap: 6, color: "#dbeafe", fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 800, fontSize: 10 }}>Risk score</span><strong style={{ color: "#fff" }}>{hover.cell.score.toFixed(3)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 800, fontSize: 10 }}>Events</span><strong style={{ color: "#fff" }}>{hover.cell.count}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 800, fontSize: 10 }}>Altitude</span><strong style={{ color: "#fff" }}>{hover.cell.xAlt.toFixed(0)} km</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: 800, fontSize: 10 }}>Rel. Velocity</span><strong style={{ color: "#fff" }}>{hover.cell.yRv.toFixed(2)} km/s</strong></div>

              {/* The rest of the requested fields are omitted gracefully if not available in the event bins. */}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Scatter({ events }) {
  // Redesign scatter using recharts: altitude vs relative velocity.
  // - Point size ~ collision probability
  // - Point color ~ risk category
  // - Opacity ~ confidence (if exists)

  const safeEvents = (events || []).filter(Boolean);

  const points = safeEvents
    .map((event) => {
      const alt = Number(event?.primary?.altitude_km ?? event?.obj_a?.altitude_km ?? event?.secondary?.altitude_km);
      const rv = Number(event?.relative_velocity_km_s ?? event?.obj_a?.velocity_kms ?? event?.obj_b?.velocity_kms);
      const prob = Number(event?.probability_of_collision ?? event?.pc ?? event?.probability_of_collision);
      const conf = Number(event?.ai_confidence ?? event?.prediction_confidence ?? 0.82);

      if (!Number.isFinite(alt) || !Number.isFinite(rv)) return null;
      return {
        id: event.id,
        name: event?.primary?.name || event?.secondary?.name || event.id,
        norad: event?.primary?.id || event?.secondary?.id,
        alt,
        rv,
        prob: Number.isFinite(prob) ? prob : 0,
        conf: Number.isFinite(conf) ? conf : 0.82,
        risk: String(event?.risk_level || "low"),
        priority: Number(event?.priority_score ?? 0),
        tca: event?.tca,
        pcSci: event?.pc_scientific,
        miss: event?.miss_distance_m,
        debrisCount: event?.debris_count,
        orbitClass: event?.orbit_class,
      };
    })
    .filter(Boolean);

  // Keep behavior stable if fields are missing.
  if (!points.length) {
    return (
      <div className="scatter">
        {safeEvents.map((event) => (
          <span
            key={event.id}
            className={RISK_CLASS[event.risk_level]}
            style={{
              left: `${Math.min(94, event.priority_score)}%`,
              bottom: `${Math.min(92, Math.max(8, -Math.log10(event.probability_of_collision || 1e-12) * 7))}%`,
            }}
          />
        ))}
      </div>
    );
  }

  const riskColorMap = {
    low: "#22c55e",
    moderate: "#38bdf8",
    elevated: "#ffd166",
    high: "#ff8a3d",
    critical: "#ef4444",
    safe: "#22c55e",
  };

  const sizeForProb = (p) => {
    const x = Math.max(0, Number(p));
    // log scaling to keep sizes reasonable.
    const s = 2 + Math.log10(x + 1e-12) * 6;
    return Math.max(2, Math.min(20, s));
  };

  const minAlt = Math.min(...points.map((p) => p.alt));
  const maxAlt = Math.max(...points.map((p) => p.alt));
  const minRv = Math.min(...points.map((p) => p.rv));
  const maxRv = Math.max(...points.map((p) => p.rv));

  // Build a custom scatter tooltip.
  const tooltipStyle = {
    background: "linear-gradient(180deg, rgba(14,28,46,0.92), rgba(5,9,18,0.72))",
    border: "1px solid rgba(129,225,255,0.22)",
    borderRadius: 12,
    padding: 12,
    color: "#dbeafe",
    boxShadow: "0 18px 50px rgba(0,0,0,0.4)",
    backdropFilter: "blur(12px)",
  };

  const renderTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    if (!p) return null;

    const risk = String(p.risk || "low").toLowerCase();
    const color = riskColorMap[risk] || "#38bdf8";

    return (
      <div style={tooltipStyle}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: color, boxShadow: `0 0 18px ${color}` }} />
          <div style={{ fontWeight: 900, color: "#fff", fontSize: 13 }}>{p.name}</div>
        </div>

        <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
          <Row label="NORAD ID" value={p.norad} />
          <Row label="Collision Probability" value={p.prob ? p.prob.toExponential(3) : "..."} />
          <Row label="Risk Score" value={p.priority ?? "..."} />
          <Row label="Relative Velocity" value={`${p.rv.toFixed(3)} km/s`} />
          <Row label="Orbital Altitude" value={`${p.alt.toFixed(1)} km`} />
          {/* Gracefully omit fields that don’t exist */}
          {p.tca ? <Row label="Time to Closest Approach" value={p.tca} /> : null}
        </div>
      </div>
    );
  };

  return (
    <div className="scatter-graph" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "#02030a", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ color: "#38bdf8", fontWeight: 900, fontSize: 12, textTransform: "uppercase" }}>Top Event Scatter</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {[
            { k: "low", l: "Low" },
            { k: "moderate", l: "Moderate" },
            { k: "high", l: "High" },
            { k: "critical", l: "Critical" },
          ].map((item) => (
            <div key={item.k} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 10, height: 10, borderRadius: 999, background: riskColorMap[item.k] || "#38bdf8" }} />
              <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{item.l}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart
            // Use LineChart just to leverage axes/grid; we'll overlay Scatter via custom dots.
            data={points}
            margin={{ top: 10, right: 14, left: 22, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#26364d" />
            <XAxis
              dataKey="alt"
              type="number"
              domain={[minAlt, maxAlt]}
              tick={{ fontSize: 11 }}
              stroke="#9fb7d9"
              unit="km"
            />
            <YAxis
              dataKey="rv"
              type="number"
              domain={[minRv, maxRv]}
              tick={{ fontSize: 11 }}
              stroke="#9fb7d9"
              unit="km/s"
            />
            <Tooltip content={renderTooltip} />

            {/* Reference lines */}
            <Line
              type="linear"
              dataKey="rv"
              stroke="rgba(255,255,255,0.0)"
              dot={false}
              activeDot={false}
            />

            {/* Custom dots using scatter-like Points */}
            {/* We rely on Recharts Scatter by mapping to a hidden Line series; easiest within existing imports. */}
            {points.map((p) => (
              <Line
                key={`pt-${p.id}`}
                type="monotone"
                data={[p]}
                dataKey="rv"
                stroke="rgba(0,0,0,0)"
                dot={(dotProps) => {
                  const { cx, cy } = dotProps;
                  const color = riskColorMap[String(p.risk).toLowerCase()] || "#38bdf8";
                  const radius = sizeForProb(p.prob);
                  const opacity = Math.max(0.1, Math.min(1, (p.conf ?? 0.82)));
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={color}
                      opacity={opacity}
                      stroke="rgba(255,255,255,0.35)"
                      strokeWidth={1}
                    />
                  );
                }}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "#94a3b8", fontWeight: 800, fontSize: 10, textTransform: "uppercase" }}>{label}</span>
      <strong style={{ color: "#fff", fontWeight: 900, fontSize: 12, textAlign: "right" }}>{String(value ?? "...")}</strong>
    </div>
  );
}


function ReportCard({ title, text, icon: Icon, onClick, disabled }) {
  return (
    <button className="report-card" type="button" onClick={onClick} disabled={disabled}>
      <Icon size={22} />
      <strong>{title}</strong>
      <span>{text}</span>
      <em>Download</em>
    </button>
  );
}

function SliderSetting({ label, value, onChange }) {
  return (
    <label className="slider-setting">
      <span>{label}</span>
      <input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{value}</strong>
    </label>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={22} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}



function buildSmartSnapshot(snapshot, events) {
  if (!snapshot) return snapshot;
  const ids = new Set();
  for (const event of events || []) {
    if (["Critical", "High", "Medium"].includes(event.risk_level)) {
      ids.add(event.primary.id);
      ids.add(event.secondary.id);
    }
  }
  const objects = snapshot.objects.filter((object) => ids.has(object.id) || object.future_risk > 0.72 || object.collision_probability > 0.68);
  const risk_cells = snapshot.risk_cells.filter((cell) => cell.probability > 0.48);
  return { ...snapshot, objects, risk_cells, stats: { ...snapshot.stats, tracked_objects: objects.length } };
}

/**
 * computeLocalManeuver - Local fallback maneuver optimizer.
 *
 * Mirrors the backend `optimize_maneuver` logic when the API is unavailable.
 * Computes delta-V, burn direction, fuel cost, before/after Pc, and risk reduction
 * from the conjunction event data. Uses a simple iterative search to find the
 * minimum delta-V that reduces Pc below 1e-6.
 *
 * @param {Object} event - Collision event with primary, secondary, miss_distance_m,
 *                          relative_velocity_km_s, covariance, probability_of_collision, etc.
 * @returns {Object} Maneuver recommendation matching backend schema
 */
function computeLocalManeuver(event) {
  if (!event) return null;

  const currentPc = Math.max(Number(event.probability_of_collision) || 1e-12, 1e-12);
  const missDistanceM = Number(event.miss_distance_m) || 300;
  const relVelocityMs = (Number(event.relative_velocity_km_s) || 1) * 1000;
  const hbrM = Number(event.combined_hard_body_radius_m) || 10;
  const tcaStr = event.tca || new Date(Date.now() + 86400000).toISOString();

  // Parse TCA
  let leadTimeS = 43200; // default 12 hours
  try {
    const tca = new Date(tcaStr.replace("Z", "+00:00"));
    leadTimeS = Math.max(1800, Math.min(86400, (tca - new Date()) / 1000));
  } catch { /* use default */ }

  // Covariance
  const cov = event.covariance || { radial_m: 50, intrack_m: 250, crosstrack_m: 100 };
  const sigmaRadial = Number(cov.radial_m) || 50;
  const sigmaIntrack = Number(cov.intrack_m) || 250;
  const sigmaCrosstrack = Number(cov.crosstrack_m) || 100;

  // Target Pc after maneuver
  const targetPc = 1e-6;

  // Local Foster 2D Pc calculator (simplified)
  function foster2D(miss, rv, hbr, sr, si, sc) {
    const sigmaX = Math.max(1, Math.sqrt(sr * sr + sc * sc));
    const sigmaY = Math.max(1, Math.sqrt(si * si + sc * sc));
    const radius = Math.max(0.1, hbr);
    const samples = 44;
    let total = 0;
    const velScale = 1 + Math.min(0.18, Math.max(0, rv - 1000) / 100000);

    for (let i = 0; i < samples; i++) {
      const x = -radius + (2 * radius * (i + 0.5) / samples);
      for (let j = 0; j < samples; j++) {
        const y = -radius + (2 * radius * (j + 0.5) / samples);
        if (x * x + y * y > radius * radius) continue;
        const dx = (x - miss) / sigmaX;
        const dy = y / sigmaY;
        total += Math.exp(-0.5 * (dx * dx + dy * dy)) / (2 * Math.PI * sigmaX * sigmaY);
      }
    }

    const area = (2 * radius / samples) ** 2;
    return Math.max(0, Math.min(1, total * area * velScale));
  }

  // Iterative delta-V search (same as backend)
  let bestDeltaV = 5.0;
  let bestPc = currentPc;
  let bestMiss = missDistanceM;

  for (let step = 1; step < 700; step++) {
    const deltaV = step * 0.01;
    const shiftedMiss = missDistanceM + deltaV * leadTimeS * 0.42;
    const pcAfter = foster2D(shiftedMiss, relVelocityMs, hbrM, sigmaRadial, sigmaIntrack, sigmaCrosstrack);
    bestDeltaV = deltaV;
    bestPc = pcAfter;
    bestMiss = shiftedMiss;
    if (pcAfter <= targetPc) break;
  }

  // Fuel calculation (same as backend)
  const isPrimaryActive = (event.primary?.category || "").toLowerCase() === "active";
  const wetMassKg = isPrimaryActive ? 420.0 : 260.0;
  const fuelKg = wetMassKg * (1 - Math.exp(-bestDeltaV / (305.0 * 9.80665)));
  const reduction = Math.max(0, (1 - bestPc / Math.max(currentPc, 1e-30)) * 100);

  // Burn direction (same as backend)
  const inclinationDiff = Math.abs(
    (event.primary?.inclination_deg || 0) - (event.secondary?.inclination_deg || 0)
  );
  const burnDirection = inclinationDiff > 6 ? "normal" : "prograde";

  // Burn time (45 min from now or 2h before TCA, whichever is later)
  let burnTime = new Date(Date.now() + 45 * 60 * 1000);
  try {
    const tcaDate = new Date(tcaStr.replace("Z", "+00:00"));
    const tcaMinus2h = new Date(tcaDate.getTime() - 2 * 60 * 60 * 1000);
    if (tcaMinus2h > burnTime) burnTime = tcaMinus2h;
  } catch { /* use default */ }

  return {
    event_id: event.id,
    recommended_action: currentPc >= 1e-4
      ? "Schedule avoidance burn"
      : "Prepare maneuver plan and continue monitoring",
    burn_direction: burnDirection,
    burn_time_utc: burnTime.toISOString(),
    delta_v_m_s: Math.round(bestDeltaV * 1000) / 1000,
    fuel_cost_kg: Math.round(fuelKg * 10000) / 10000,
    probability_before: currentPc,
    probability_after: bestPc,
    miss_distance_before_m: Math.round(missDistanceM * 100) / 100,
    miss_distance_after_m: Math.round(bestMiss * 100) / 100,
    risk_reduction_pct: Math.round(reduction * 100) / 100,
    mission_impact: "Low fuel impact; review attitude and payload constraints before uplink.",
    trajectory: {
      before: [
        { t_min: -30, separation_m: missDistanceM * 1.8 },
        { t_min: -15, separation_m: missDistanceM * 1.2 },
        { t_min: 0, separation_m: missDistanceM },
        { t_min: 15, separation_m: missDistanceM * 1.2 },
        { t_min: 30, separation_m: missDistanceM * 1.8 },
      ],
      after: [
        { t_min: -30, separation_m: bestMiss * 1.8 },
        { t_min: -15, separation_m: bestMiss * 1.2 },
        { t_min: 0, separation_m: bestMiss },
        { t_min: 15, separation_m: bestMiss * 1.2 },
        { t_min: 30, separation_m: bestMiss * 1.8 },
      ],
    },
  };
}

/**
 * Apply type-aware operational prioritization to a list of collision events.
 *
 * This is a SEPARATE ranking layer from the scientific Foster 2D Pc.
 * Scientific Pc values remain UNCHANGED.
 *
 * Each event receives an operational_priority_score that combines:
 * - pair type (satellite-debris = highest priority)
 * - scientific Pc (actual collision probability)
 * - miss distance
 * - relative velocity
 * - existing risk level
 *
 * Events are ranked by operational_priority_score, not by Pc alone.
 * This ensures that ACTIVE SATELLITE vs SPACE DEBRIS events appear
 * at the top even when debris-debris events have similar Pc values.
 *
 * @param {Array} events - Array of validated collision events
 * @returns {Array} Events sorted by operational priority, with operational_priority_score added
 */
function applyOperationalPrioritization(events) {
  if (!events || !Array.isArray(events)) return [];

  const prioritized = events.map((event) => {
    const operationalScore = computeOperationalPriority(event);
    return {
      ...event,
      operational_priority_score: operationalScore,
      pair_type: event.pair_type || getPairType(event.primary, event.secondary),
    };
  });

  // Sort by operational priority score descending
  prioritized.sort((a, b) => (b.operational_priority_score || 0) - (a.operational_priority_score || 0));

  // PRESERVE original backend event ID for API lookups (maneuver, download report).
  // We preserve `event.id` as the original backend ID and add `displayId` for UI ordering.
  // This is CRITICAL because:
  //   - Download Report → needs original event ID to find the backend PDF endpoint ✓
  //   - Maneuver API → needs original event ID at `/api/conjunctions/{event_id}/maneuver` ✓
  //   - UI sorting → uses operational_priority_score for ranking order ✓
  //   - Event identification in lists → all events keep their real IDs ✓
  prioritized.forEach((event, index) => {
    // DO NOT overwrite event.id - it MUST remain the original backend ID
    // for API calls to work correctly.
    event.displayId = `OP-${index + 1}`;  // display-only ID for UI
  });

  return prioritized;
}

/**
 * Log pair type distribution for verification.
 */
function logPairTypeDistribution(events) {
  if (!events || !Array.isArray(events)) {
    console.warn("[OperationalPriority] No events to analyze");
    return;
  }

  const counts = {
    "SATELLITE vs DEBRIS": 0,
    "SATELLITE vs ROCKET BODY": 0,
    "SATELLITE vs SATELLITE": 0,
    "DEBRIS vs ROCKET BODY": 0,
    "DEBRIS vs DEBRIS": 0,
    "ROCKET BODY vs ROCKET BODY": 0,
    UNKNOWN: 0,
  };

  let activeDebrisCount = 0;
  let topSatelliteDebris = null;

  for (const event of events) {
    const pairType = event.pair_type || getPairType(event.primary, event.secondary);
    if (counts[pairType] !== undefined) {
      counts[pairType]++;
    } else {
      counts.UNKNOWN++;
    }

    if (pairType === "SATELLITE vs DEBRIS") {
      activeDebrisCount++;
      if (!topSatelliteDebris) {
        topSatelliteDebris = event;
      }
    }
  }

  console.info(
    `[OperationalPriority] Pair type distribution (${events.length} total events):\n` +
    `  SATELLITE vs DEBRIS:       ${counts["SATELLITE vs DEBRIS"]}\n` +
    `  SATELLITE vs ROCKET BODY:  ${counts["SATELLITE vs ROCKET BODY"]}\n` +
    `  SATELLITE vs SATELLITE:    ${counts["SATELLITE vs SATELLITE"]}\n` +
    `  DEBRIS vs ROCKET BODY:     ${counts["DEBRIS vs ROCKET BODY"]}\n` +
    `  DEBRIS vs DEBRIS:          ${counts["DEBRIS vs DEBRIS"]}\n` +
    `  ROCKET BODY vs ROCKET BODY: ${counts["ROCKET BODY vs ROCKET BODY"]}\n` +
    `  UNKNOWN:                   ${counts.UNKNOWN}`
  );

  if (activeDebrisCount === 0) {
    console.warn(
      `[OperationalPriority] WARNING: No ACTIVE SATELLITE vs SPACE DEBRIS events found. ` +
      `The catalog may not contain enough active satellites in conjunction risk zones.`
    );
  } else {
    console.info(
      `[OperationalPriority] Top satellite-debris event: ` +
      `"${topSatelliteDebris?.primary?.name || "?"} · ID: ${topSatelliteDebris?.primary?.id || "?"}" ` +
      `vs "${topSatelliteDebris?.secondary?.name || "?"} · ID: ${topSatelliteDebris?.secondary?.id || "?"}"`
    );
  }
}

/**
 * Build a CSV export of the conjunction events currently displayed,
 * including the satellite / debris pair shown on the globe.
 */
function buildConjunctionsCsv(events) {
  const headers = [
    "event_id",
    "pair_type",
    "risk_level",
    "priority_score",
    "tca_utc",
    "miss_distance_m",
    "relative_velocity_km_s",
    "probability_of_collision",
    "primary_name",
    "primary_id",
    "primary_type",
    "primary_band",
    "primary_orbit_type",
    "primary_altitude_km",
    "primary_inclination_deg",
    "primary_velocity_kms",
    "secondary_name",
    "secondary_id",
    "secondary_type",
    "secondary_band",
    "secondary_orbit_type",
    "secondary_altitude_km",
    "secondary_inclination_deg",
    "secondary_velocity_kms",
  ];

  const rows = (events || []).map((event) => {
    const p = buildCanonicalIdentity(event.primary);
    const sec = buildCanonicalIdentity(event.secondary);
    return [
      event.id,
      event.pair_type || getPairType(event.primary, event.secondary),
      event.risk_level,
      event.priority_score,
      event.tca,
      event.miss_distance_m,
      event.relative_velocity_km_s,
      event.probability_of_collision,
      p.name,
      p.id,
      p.displayType,
      event.primary?.band,
      event.primary?.orbit_type,
      event.primary?.altitude_km,
      event.primary?.inclination_deg,
      event.primary?.velocity_kms,
      sec.name,
      sec.id,
      sec.displayType,
      event.secondary?.band,
      event.secondary?.orbit_type,
      event.secondary?.altitude_km,
      event.secondary?.inclination_deg,
      event.secondary?.velocity_kms,
    ];
  });

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function downloadCsvFile(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function buildLocalConjunctions(snapshot) {
  const catalog = (snapshot?.objects || []).slice().sort((a, b) => b.future_risk - a.future_risk);

  // Build satellite-vs-debris pairs explicitly so the Object Information panel
  // always shows one ACTIVE SATELLITE and one SPACE DEBRIS object.
  const satellites = catalog.filter((item) => resolveObjectType(item) === OBJECT_TYPE.ACTIVE_SATELLITE).slice(0, 18);
  const debris = catalog
    .filter((item) => {
      const type = resolveObjectType(item);
      return type === OBJECT_TYPE.SPACE_DEBRIS || type === OBJECT_TYPE.FRAGMENT || type === OBJECT_TYPE.ROCKET_BODY;
    })
    .sort((x, y) => (resolveObjectType(x) === OBJECT_TYPE.SPACE_DEBRIS ? -1 : 1) - (resolveObjectType(y) === OBJECT_TYPE.SPACE_DEBRIS ? -1 : 1))
    .slice(0, 18);

  const pairs = [];
  const pairCount = Math.min(satellites.length, debris.length);
  for (let index = 0; index < pairCount; index += 1) {
    pairs.push([satellites[index], debris[index]]);
  }
  // If the catalog lacks one of the classes, fall back to sequential pairing.
  if (!pairs.length) {
    for (let index = 0; index < catalog.length - 1 && index < 36; index += 2) {
      pairs.push([catalog[index], catalog[index + 1]]);
    }
  }

  const events = [];
  const usedPairs = new Set();
  let validCount = 0;

  for (let i = 0; i < pairs.length; i += 1) {
    const [a, b] = pairs[i];

    // SELF-PAIR PREVENTION: never generate A vs A
    if (a.id === b.id) {
      console.warn(`[SSA Identity] Skipping self-pair: object ${a.id} (${a.name}) would be paired with itself`);
      continue;
    }

    // DUPLICATE PAIR PREVENTION: canonicalize pair key so (A,B) and (B,A) are the same
    const pairKey = makePairKey(a.id, b.id);
    if (usedPairs.has(pairKey)) {
      continue;
    }
    usedPairs.add(pairKey);

    // Build canonical identities for both objects
    const primaryIdentity = buildCanonicalIdentity(a);
    const secondaryIdentity = buildCanonicalIdentity(b);

    // Determine the pair type
    const pairType = getPairType(a, b);
    const isSatDebris = isSatelliteDebrisPair(a, b);

    // Log the pair type for verification
    console.info(
      `[SSA Identity] Pair ${validCount + 1}: ${primaryIdentity.name} (${primaryIdentity.displayType}, ID: ${primaryIdentity.id}) ` +
      `vs ${secondaryIdentity.name} (${secondaryIdentity.displayType}, ID: ${secondaryIdentity.id}) ` +
      `→ ${pairType}`
    );

    const pc = Math.max(1e-9, (a.collision_probability + b.collision_probability) / 2 / 1400);
    const risk = pc > 1e-4 ? "High" : pc > 1e-6 ? "Medium" : "Low";
    validCount++;

    // Create object summaries that include canonical identity
    const primarySummary = {
      ...a,
      object_type: primaryIdentity.objectType,
      canonicalName: primaryIdentity.name,
      canonicalType: primaryIdentity.displayType,
      canonicalId: primaryIdentity.id,
    };
    const secondarySummary = {
      ...b,
      object_type: secondaryIdentity.objectType,
      canonicalName: secondaryIdentity.name,
      canonicalType: secondaryIdentity.displayType,
      canonicalId: secondaryIdentity.id,
    };

    events.push({
      id: `LOCAL-${validCount}`,
      primary: primarySummary,
      secondary: secondarySummary,
      obj_a: primarySummary,
      obj_b: secondarySummary,
      pair_type: pairType,
      is_satellite_debris: isSatDebris,
      tca: new Date(Date.now() + (i + 2) * 3600_000).toISOString(),
      miss_distance_m: 300 + i * 40,
      relative_velocity_km_s: Math.abs(a.velocity_kms - b.velocity_kms) + 1,
      probability_of_collision: pc,
      pc,
      pc_scientific: pc.toExponential(3),
      risk_level: risk,
      ai_class: risk === "High" ? "HIGH" : "WATCHLIST",
      ai_confidence: 82,
      priority_score: risk === "High" ? 84 : 58,
      suggested_action: risk === "High" ? "Schedule conjunction review." : "Add to watchlist.",
      covariance: { radial_m: 80, intrack_m: 320, crosstrack_m: 130 },
      features: { inclination_difference_deg: Math.abs(a.inclination_deg - b.inclination_deg) },
      ai_contributors: [{ feature: "collision_probability", contribution_pct: 38 }, { feature: "miss_distance", contribution_pct: 31 }],
      ai_explanation: `Fallback ${pairType} conjunction derived from propagated risk score, debris density, and orbit geometry.`,
    });
  }
  console.info(`[SSA Identity] Generated ${validCount} valid events (${events.length - validCount} rejected for identity issues)`);
  return events;
}

function buildLocalAnalytics(snapshot, events) {
  const risk_distribution = {};
  for (const event of events) risk_distribution[event.risk_level] = (risk_distribution[event.risk_level] || 0) + 1;
  return {
    total_objects: snapshot?.stats?.tracked_objects || 0,
    active_satellites: snapshot?.stats?.active_satellites || 0,
    debris_objects: snapshot?.stats?.debris_objects || 0,
    total_conjunctions: events.length,
    high_priority_events: events.filter((event) => event.risk_level === "High").length,
    average_pc_scientific: scientific(events.reduce((sum, event) => sum + event.probability_of_collision, 0) / Math.max(1, events.length)),
    global_risk: snapshot?.stats?.global_risk || 0,
    forecast_trend: snapshot?.stats?.forecast_trend || 0,
    risk_distribution,
    band_distribution: { LEO: snapshot?.stats?.leo || 0, MEO: snapshot?.stats?.meo || 0, GEO: snapshot?.stats?.geo || 0 },
    risk_timeline: [],
  };
}

function buildLocalSmart(events, totalObjects) {
  const retained = events.filter((event) => ["High", "Medium", "Critical"].includes(event.risk_level));
  return {
    raw_events: events.length,
    objects_analyzed: totalObjects,
    after_filter: retained.length,
    reduction_pct: Math.round((1 - retained.length / Math.max(1, events.length)) * 100),
    avg_confidence_pct: 82,
    by_class: { HIGH: retained.length, MONITOR: Math.max(0, events.length - retained.length) },
    briefing: `${totalObjects.toLocaleString()} objects analyzed. ${retained.length} conjunctions require analyst attention.`,
    pipeline_stages: [],
  };
}

function pushNotice(setNotices, message, type) {
  setNotices((current) => [...current.slice(-5), { message, type, at: Date.now() }]);
}

function scientific(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "...";
  return Number(value).toExponential(3);
}