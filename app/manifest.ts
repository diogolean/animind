import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Animind",
    short_name: "Animind",
    description: "Personagens falantes animados em 3 cliques.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0b14",
    theme_color: "#0d0b14",
    lang: "pt-BR",
    categories: ["entertainment", "education", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
