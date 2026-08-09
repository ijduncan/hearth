import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hearth",
    short_name: "Hearth",
    description: "A private AI journaling app for your household",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#9a3412",
    categories: ["lifestyle"],
    icons: [
      {
        src: "/icons/hearth-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/hearth-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/hearth-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
