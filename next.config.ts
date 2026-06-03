import type { NextConfig } from "next";

// Build timestamp, baked in at build time (and at dev-server start) and shown in
// the nav. Matches the sibling-repo norm (see ../musicforge): America/Los_Angeles,
// 24-hour, formatted "MM/DD/YYYY HH:MM". Exposed to the browser via a NEXT_PUBLIC_
// var, which Next inlines into the client bundle during `next build`.
const buildTime = new Date()
  .toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  .replace(",", "");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
};

export default nextConfig;
