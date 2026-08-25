import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function brandPlaceholders(
  appName = "Compart Mail",
  description = "Studio mail for Compart Software.",
): Plugin {
  const replace = (source: string) =>
    source.replaceAll("__APP_NAME__", appName).replaceAll("__APP_DESCRIPTION__", description);

  return {
    name: "brand-placeholders",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return replace(html);
      },
    },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === "asset" && typeof item.source === "string" && item.fileName.endsWith(".webmanifest")) {
          item.source = replace(item.source);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brandPlaceholders()],
  build: {
    outDir: "dist",
  },
});
