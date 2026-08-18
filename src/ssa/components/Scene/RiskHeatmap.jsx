import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { RISK_ORDER, degToRad, riskColor, riskRadius } from "../../utils/orbitalMath";

/**
 * Heatmap implementation notes:
 * - Previously this component rendered a handful of torus meshes ("blocks").
 * - This version renders a dense, continuous probability field using InstancedMesh discs
 *   + optional particle shimmer + annotations via sprite labels.
 * - The field is view-friendly: additive blending, no depthWrite, and small disc sizes.
 */

export function RiskHeatmap({ riskCells, filters, forecastHours, selectedRisk, onSelectRisk }) {
  const { camera } = useThree();
  const [hoveredCell, setHoveredCell] = useState(null);

  const visibleCells = useMemo(() => {
    return (riskCells || []).filter((cell) => {
      const bandOk = filters?.[cell.band] ?? true;
      const severityOk = filters?.[cell.severity] ?? true;
      return bandOk && severityOk;
    });
  }, [riskCells, filters]);

  const hotspotStory = useMemo(() => {
    const list = visibleCells || [];
    if (!list.length) {
      return {
        highestRisk: null,
        highestDensity: null,
        mostCongested: null,
        avgCollisionProbability: null,
      };
    }

    let highestRisk = list[0];
    let highestDensity = list[0];

    for (const c of list) {
      const p = safeNum(c.probability) ?? 0;
      const hp = safeNum(highestRisk.probability) ?? 0;
      if (p > hp) highestRisk = c;

      const d = safeNum(c.untracked_density) ?? 0;
      const hd = safeNum(highestDensity.untracked_density) ?? 0;
      if (d > hd) highestDensity = c;
    }

    // Most congested proxy: weighted mix of probability and density (no fabricated values).
    let mostCongested = list[0];
    let bestScore = -Infinity;
    for (const c of list) {
      const p = safeNum(c.probability) ?? 0;
      const d = safeNum(c.untracked_density) ?? 0;
      const score = p * 0.78 + d * 0.22;
      if (score > bestScore) {
        bestScore = score;
        mostCongested = c;
      }
    }

    const ps = list.map((c) => safeNum(c.probability)).filter((v) => v !== undefined);
    const avgCollisionProbability = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;

    return { highestRisk, highestDensity, mostCongested, avgCollisionProbability };
  }, [visibleCells]);

  const annotations = useMemo(() => {
    const max = 14;

    const ranked = [...visibleCells].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
    const top = ranked.slice(0, max);

    const story = [hotspotStory.highestRisk, hotspotStory.mostCongested, hotspotStory.highestDensity].filter(Boolean);

    const merged = [...story, ...top];

    // De-dupe by id (or by reference fallback).
    const seen = new Set();
    const unique = [];
    for (const c of merged) {
      const key = c?.id ?? c;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(c);
    }

    const limited = unique.slice(0, max);

    if (selectedRisk?.id) {
      const hasSelected = limited.some((c) => c?.id === selectedRisk.id);
      if (!hasSelected) {
        const sel = visibleCells.find((c) => c.id === selectedRisk.id);
        if (sel) return [sel, ...limited.slice(0, max - 1)];
      }
    }

    if (hoveredCell?.id) {
      const hasHovered = limited.some((c) => c?.id === hoveredCell.id);
      if (!hasHovered) {
        const hc = visibleCells.find((c) => c.id === hoveredCell.id);
        if (hc) return [hc, ...limited.slice(0, max - 1)];
      }
    }

    return limited;
  }, [visibleCells, hotspotStory, selectedRisk, hoveredCell]);

  // NOTE: Keep RiskHeatmap render tree free of raw DOM (no <div> inside Canvas tree).
  // Tooltips/AI panels must not be rendered as DOM nodes from within the component mounted under <Canvas>.
  return (
    <group>
      <ContinuousHeatField
        cells={visibleCells}
        forecastHours={forecastHours}
        selectedRiskId={selectedRisk?.id}
        onSelectRisk={onSelectRisk}
        onHoverCell={setHoveredCell}
      />
      <Annotations
        camera={camera}
        cells={annotations}
        selectedRiskId={selectedRisk?.id}
        onSelectRisk={onSelectRisk}
        forecastHours={forecastHours}
      />
      <UntrackedShimmer cells={visibleCells} forecastHours={forecastHours} />
    </group>
  );
}

function continuousRiskLabel(severity) {
  const s = (severity ?? "").toString().toLowerCase();
  if (s.includes("very")) return "Very Low";
  if (s.includes("low")) return "Low";
  if (s.includes("moderate") || s.includes("med")) return "Moderate";
  if (s.includes("elevated")) return "Elevated";
  if (s.includes("high")) return "High";
  if (s.includes("critical")) return "Critical";
  if (s.includes("extreme")) return "Extreme";
  return (severity ?? "Unknown").toString();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formatValueCell(label, value, fmtFn) {
  if (value === undefined || value === null) return null;
  const rendered = fmtFn ? fmtFn(value) : value;
  return rendered === undefined || rendered === null ? null : `${label}: ${rendered}`;
}

function ContinuousHeatField({ cells, forecastHours, selectedRiskId, onSelectRisk, onHoverCell }) {
  const instRef = useRef();

  const { ordered, matrices, colors } = useMemo(() => {
    const maxCells = 260;
    const ordered = [...cells].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
    const trimmed = ordered.slice(0, Math.min(maxCells, ordered.length));

    const matrices = [];
    const colors = [];

    const tempObj = new THREE.Object3D();

    for (let i = 0; i < trimmed.length; i += 1) {
      const cell = trimmed[i];
      const radius = riskRadius(cell.altitude_km);

      const rotX = Math.PI / 2 + degToRad(cell.inclination_deg);
      const rotY = degToRad(cell.raan_deg);

      // Primary intensity: probability (primary)
      const probability = cell.probability ?? 0;
      // Secondary emphasis: debris/untracked density (if present)
      const untracked = cell.untracked_density ?? 0;

      // Primary classification: severity => used only for base color mapping
      const severityBoost = (RISK_ORDER[cell.severity] ?? 0) * 0.06;

      // Replace hard scaling with softer scientific emphasis:
      // - Size indicates probability + (secondary) density
      // - Opacity encoded through color multiplier to stay on MeshBasicMaterial
      // Reduce disc scale to lessen visual competition with orbit paths thickness.
      const discScale = 0.30 + probability * 0.78 + untracked * 0.11 + severityBoost;
      const opacityBase = 0.030 + probability * 0.50 + untracked * 0.10;

      const isSelected = cell.id === selectedRiskId;
      const opacity = Math.min(0.92, opacityBase + (isSelected ? 0.35 : 0));

      tempObj.position.set(0, 0, 0);
      tempObj.rotation.set(rotX, rotY, 0);
      tempObj.scale.setScalar(discScale);
      tempObj.translateZ(radius);
      tempObj.updateMatrix();

      matrices.push(tempObj.matrix.clone());

      // Risk-aligned gradient progression comes from riskColor().
      // Improve depth/clarity using a non-rainbow blend via opacity multiplier.
      const col = new THREE.Color(riskColor(cell.severity));
      col.multiplyScalar(0.28 + opacity);
      colors.push(col.r, col.g, col.b);
    }

    return { ordered: trimmed, matrices, colors };
  }, [cells, selectedRiskId]);

  const geometry = useMemo(() => new THREE.CircleGeometry(1, 28), []);

  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 1,
    });
  }, []);

  useMemo(() => {
    const mesh = instRef.current;
    if (!mesh) return;

    const count = matrices.length;
    mesh.count = Math.max(1, count);

    for (let i = 0; i < count; i += 1) {
      mesh.setMatrixAt(i, matrices[i]);

      const col = new THREE.Color(colors[i * 3 + 0], colors[i * 3 + 1], colors[i * 3 + 2]);
      mesh.setColorAt(i, col);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [matrices, colors]);

  useFrame(({ clock }) => {
    if (!instRef.current) return;
    const t = clock.elapsedTime;

    instRef.current.rotation.y = t * (0.028 + forecastHours * 0.00018);
    instRef.current.rotation.x = Math.sin(t * 0.17) * 0.03;

    // Keep subtle breathing; avoid distracting animation.
    const pulse = 1 + Math.sin(t * 0.85 + forecastHours * 0.06) * 0.035;
    instRef.current.scale.setScalar(pulse);
  });

  return (
    <instancedMesh
      ref={instRef}
      args={[geometry, material, Math.max(1, matrices.length)]}
      frustumCulled={false}
      onPointerMove={(e) => {
        e.stopPropagation();
        const idx = e.instanceId;
        if (idx == null) return;
        const cell = ordered[idx];
        if (cell) onHoverCell(cell);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHoverCell(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        const idx = e.instanceId;
        if (idx == null) return;
        const cell = ordered[idx];
        if (cell) onSelectRisk(cell);
      }}
    />
  );
}


function Annotations({ camera, cells, selectedRiskId, onSelectRisk, forecastHours }) {
  const groupRef = useRef();
  const sprites = useMemo(() => {
    const list = [];
    for (const cell of cells) {
      const radius = riskRadius(cell.altitude_km);
      const rotX = Math.PI / 2 + degToRad(cell.inclination_deg);
      const rotY = degToRad(cell.raan_deg);

      const canvas = document.createElement("canvas");
      canvas.width = 560;
      canvas.height = 290;
      const ctx = canvas.getContext("2d");

      // Background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const col = riskColor(cell.severity);
      const alpha = cell.id === selectedRiskId ? 0.98 : 0.75;

      const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      bg.addColorStop(0, `rgba(0,0,0,0.0)`);
      bg.addColorStop(0.12, `rgba(0,0,0,0.22)`);
      bg.addColorStop(1, `rgba(0,0,0,0.48)`);

      ctx.fillStyle = `rgba(5,8,20,${alpha})`;
      roundRect(ctx, 18, 18, canvas.width - 36, canvas.height - 36, 24);
      ctx.fillStyle = `rgba(10,16,36,${alpha})`;
      roundRect(ctx, 18, 18, canvas.width - 36, canvas.height - 36, 24);
      ctx.fill();

      // Border
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      roundRect(ctx, 18, 18, canvas.width - 36, canvas.height - 36, 24);
      ctx.stroke();

      // Header
      ctx.fillStyle = "rgba(230,247,255,0.94)";
      ctx.font = "800 34px Inter, system-ui, sans-serif";
      ctx.fillText(continuousRiskLabel(cell.severity), 42, 96);

      // Primary probability
      ctx.fillStyle = "rgba(170,215,236,0.98)";
      ctx.font = "700 22px Inter, system-ui, sans-serif";
      const probText = cell.probability !== undefined ? `P=${formatPct(cell.probability)}` : "P=N/A";
      ctx.fillText(probText, 42, 142);

      // Secondary metrics (omit gracefully)
      const items = [];

      const alt = safeNum(cell.altitude_km);
      if (alt !== undefined) items.push(formatValueCell("Altitude", alt, (v) => `${fmt(v, 0)} km`));

      const dens = safeNum(cell.untracked_density);
      if (dens !== undefined) items.push(formatValueCell("Debris Density", dens, (v) => `${fmt(v, 2)}`));

      const conf = safeNum(cell.confidence);
      if (conf !== undefined) items.push(formatValueCell("Confidence", conf, (v) => `${fmt(v, 2)}`));

      const lineYStart = 174;
      let dy = 26;
      for (let k = 0; k < Math.min(3, items.length); k += 1) {
        ctx.fillStyle = "rgba(160,200,230,0.88)";
        ctx.font = "600 18px Inter, system-ui, sans-serif";
        ctx.fillText(items[k], 42, lineYStart + k * dy);
      }

      // Marker
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(470, 110, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;

      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });

      const sprite = new THREE.Sprite(material);
      const base = cell.id === selectedRiskId ? 0.95 : 0.62;
      sprite.scale.set(base * 2.2, base * 1.08, 1);

      const tmp = new THREE.Object3D();
      tmp.position.set(0, 0, 0);
      tmp.rotation.set(rotX, rotY, 0);
      tmp.translateZ(radius + (cell.id === selectedRiskId ? 0.28 : 0.20));
      tmp.updateMatrix();

      sprite.position.setFromMatrixPosition(tmp.matrix);
      sprite.userData = { cellId: cell.id, hoverPhase: Math.random() * 6 };

      list.push({ sprite, cell });
    }

    return list;
  }, [cells, selectedRiskId]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;

    for (const { sprite } of sprites) {
      sprite.quaternion.copy(camera.quaternion);

      const phase = sprite.userData.hoverPhase || 0;
      const bob = Math.sin(t * 1.05 + phase + forecastHours * 0.03) * 0.055;
      sprite.position.y += bob * 0.015;

      if (sprite.userData.cellId === selectedRiskId) sprite.scale.multiplyScalar(1.0007);
    }
  });

  return (
    <group ref={groupRef}>
      {sprites.map(({ sprite, cell }) => (
        <primitive
          key={cell.id}
          object={sprite}
          onClick={(e) => {
            e.stopPropagation();
            onSelectRisk(cell);
          }}
        />
      ))}
    </group>
  );
}

function UntrackedShimmer({ cells, forecastHours }) {
  const pointsRef = useRef();

  const geometry = useMemo(() => {
    const positions = [];
    const colors = [];

    // Keep shimmer lightweight to avoid visually overwhelming orbit paths.
    // TEMP: further reduce density/points to restore "thicker" orbit-line look.
    const max = 55;
    const maxCells = Math.min(max, cells.length);
    const sorted = [...cells].sort((a, b) => (b.untracked_density ?? 0) - (a.untracked_density ?? 0));
    const trimmed = sorted.slice(0, maxCells);

    const color = new THREE.Color();

    for (let c = 0; c < trimmed.length; c += 1) {
      const cell = trimmed[c];
      const radius = riskRadius(cell.altitude_km);

      // TEMP stability guard: clamp points-per-cell further.
      const rawCount = 18 + (cell.untracked_density ?? 0) * 95 + (RISK_ORDER[cell.severity] ?? 0) * 7;
      const count = Math.min(8, Math.max(0, Math.round(rawCount)));

      for (let i = 0; i < count; i += 1) {
        const t = seeded(c * 819 + i * 23);
        const angle = t * Math.PI * 2;
        const inc = degToRad(cell.inclination_deg + (seeded(i + c) - 0.5) * 11);
        const raan = degToRad(cell.raan_deg);

        const radial = radius + (seeded(i * 3 + c) - 0.5) * 0.62 + (cell.probability ?? 0) * 0.15;

        const p = new THREE.Vector3(Math.cos(angle) * radial, (seeded(i * 7 + c) - 0.5) * 0.9, Math.sin(angle) * radial);
        p.applyAxisAngle(new THREE.Vector3(1, 0, 0), inc);
        p.applyAxisAngle(new THREE.Vector3(0, 1, 0), raan);

        positions.push(p.x, p.y, p.z);

        color.set(riskColor(cell.severity));
        // Fade low-probability points more aggressively.
        const alpha = 0.12 + (cell.probability ?? 0) * 0.28;
        colors.push(color.r, color.g, color.b, alpha);
      }
    }

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    buffer.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    return buffer;
  }, [cells]);

  // Reduce opacity to ensure orbit paths remain visually dominant.
  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={0.028}
        transparent
        opacity={0.14}
        vertexColors={false}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function seeded(value) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function formatPct(p) {
  const v = (p ?? 0) * 100;
  return `${Math.round(v)}%`;
}

function fmt(v, digits) {
  const n = Number(v ?? 0);
  const d = digits ?? 0;
  return n.toFixed(d);
}


