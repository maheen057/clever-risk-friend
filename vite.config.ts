// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * The dev devtools plugin annotates every JSX element with `data-tsd-source`.
 * react-three-fiber treats unknown props as three.js object properties, so that
 * attribute crashes the WebGL scene ("Cannot set \"data-tsd-source\"").
 * Strip the annotation from the react-three-fiber files after it is injected.
 */
function stripDevtoolsSourceInR3F() {
  return {
    name: "strip-devtools-source-in-r3f",
    enforce: "post" as const,
    transform(code: string, id: string) {
      const file = id.split("?")[0];
      if (!/\/src\/ssa\/components\/Scene\//.test(file)) return null;
      if (!code.includes("data-tsd-source")) return null;
      return {
        code: code.replace(/\s*"data-tsd-source":\s*"[^"]*",?/g, "").replace(/\s*data-tsd-source="[^"]*"/g, ""),
        map: null,
      };
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [stripDevtoolsSourceInR3F()],
  },
});
