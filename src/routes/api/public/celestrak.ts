import { createFileRoute } from "@tanstack/react-router";

type GpRecord = Record<string, unknown>;

const GROUPS: Array<{ group: string; kind: "active" | "debris" }> = [
  { group: "stations", kind: "active" },
  { group: "weather", kind: "active" },
  { group: "gps-ops", kind: "active" },
  { group: "galileo", kind: "active" },
  { group: "starlink", kind: "active" },
  { group: "iridium-33-debris", kind: "debris" },
  { group: "cosmos-2251-debris", kind: "debris" },
  { group: "1999-025", kind: "debris" },
];

let cache: { at: number; payload: unknown } | null = null;
const TTL_MS = 15 * 60 * 1000;

async function fetchGroup(group: string): Promise<GpRecord[]> {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return [];
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as GpRecord[]) : [];
}

export const Route = createFileRoute("/api/public/celestrak")({
  server: {
    handlers: {
      GET: async () => {
        if (cache && Date.now() - cache.at < TTL_MS) {
          return Response.json(cache.payload);
        }
        const results = await Promise.all(
          GROUPS.map(async ({ group, kind }) => {
            try {
              const records = await fetchGroup(group);
              // Cap per group so the payload stays manageable.
              return records
                .slice(0, kind === "active" ? 160 : 140)
                .map((record) => ({ ...record, source_group: group, source_kind: kind }));
            } catch {
              return [];
            }
          }),
        );
        const records = results.flat();
        if (!records.length) {
          return Response.json({ ok: false, records: [] }, { status: 502 });
        }
        const payload = {
          ok: true,
          source: "CelesTrak GP (real-time TLE)",
          fetched_at: new Date().toISOString(),
          records,
        };
        cache = { at: Date.now(), payload };
        return Response.json(payload);
      },
    },
  },
});
