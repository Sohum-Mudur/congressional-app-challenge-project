import type { MetadataRoute } from "next";

/** Lets people "Add to Home Screen" so the app opens full-screen like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Signal Report",
    short_name: "Signal Report",
    description: "Report broken traffic lights to the agency that fixes them.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f4",
    theme_color: "#dc2626",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
