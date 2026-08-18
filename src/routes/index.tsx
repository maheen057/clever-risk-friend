import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

const SsaApp = lazy(() =>
  import("../ssa/App.jsx").then((m) => ({ default: m.default })),
);

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Orbital Risk Intelligence — Live Space Debris Visualization" },
      {
        name: "description",
        content:
          "Real-time 3D space situational awareness: hover the globe to identify satellites and debris, track orbital bands, and forecast collision risk from CelesTrak data.",
      },
      { property: "og:title", content: "Orbital Risk Intelligence — Live Space Debris Visualization" },
      {
        property: "og:description",
        content:
          "Real-time 3D space situational awareness: hover the globe to identify satellites and debris, track orbital bands, and forecast collision risk from CelesTrak data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Loading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#02030a",
        color: "#9fd7ee",
        fontFamily: "Inter, system-ui, sans-serif",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        fontSize: 12,
      }}
    >
      Initializing orbital telemetry…
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <SsaApp />
      </Suspense>
    </ClientOnly>
  );
}
