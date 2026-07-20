import type { MetadataRoute } from "next";

// Web app manifest (Next App Router convention) — served at
// /manifest.webmanifest. Lets iOS/Android "Add to Home Screen" launch
// recountly full-screen instead of as a Safari tab. Colors match the app's
// dark background (globals.css --background dark: #0a0a0a) and the "REC
// lamp" brand red (lamp.ts's live-state bg-red-600, #dc2626).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "recountly",
    short_name: "recountly",
    description: "A private spoken-word journal. Speak, and watch the words appear.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
