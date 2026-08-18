import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { BAND_COLORS, ringPoints } from "../../utils/orbitalMath";

export function OrbitShells({ objects, filters }) {
  const trails = useMemo(() => {
    const visible = objects.filter((object) => filters[object.band] && (object.category === "debris" ? filters.debris : filters.active));
    const important = visible
      .slice()
      .sort((a, b) => b.collision_probability - a.collision_probability)
      .slice(0, 46);
    return important.map((object) => ({
      id: object.id,
      band: object.band,
      category: object.category,
      points: ringPoints(object.orbit, 144),
      opacity: object.category === "debris" ? 0.22 : 0.16,
    }));
  }, [objects, filters]);

  return (
    <group>
      {trails.map((trail) => (
        <Line
          key={trail.id}
          points={trail.points}
          color={trail.category === "debris" ? "#ff6f52" : BAND_COLORS[trail.band]}
          lineWidth={2.0}
          transparent
          opacity={trail.category === "debris" ? 0.35 : 0.28}
        />
      ))}
      <ReferenceShell radius={2.68} color="#42f5b3" opacity={0.08} />
      <ReferenceShell radius={9.0} color="#ffd166" opacity={0.055} />
      <ReferenceShell radius={15.95} color="#ff8a3d" opacity={0.06} />
    </group>
  );
}

function ReferenceShell({ radius, color, opacity }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.003, 10, 240]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

