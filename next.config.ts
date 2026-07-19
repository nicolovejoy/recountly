import type { NextConfig } from "next";

// Build timestamp, baked in at build time (and at dev-server start) and shown in
// the nav. Matches the mother-site norm (../selected-projects nav.tsx —
// pianohouseproject.org): "Mar 4, 2:37 pm", America/Los_Angeles. Exposed to the
// browser via a NEXT_PUBLIC_ var, which Next inlines during `next build`.
const buildTime = new Date()
  .toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  .replace(/AM/, "am")
  .replace(/PM/, "pm");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
};

export default nextConfig;
