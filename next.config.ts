import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Dónde deja Next su build. Se puede mover con `NEXT_DIST_DIR` para que el
   * servidor de producción que levantan los E2E offline no pise el `.next` del
   * `next dev` que corre a la vez (ver playwright.config.ts).
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
