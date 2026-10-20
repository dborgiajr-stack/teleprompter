// Runs after `expo export --platform web`. Makes the site installable to a phone's
// home screen and lets deep links (e.g. /play?id=…) load on GitHub Pages.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
const base = (JSON.parse(readFileSync("app.json", "utf8")).expo.experiments?.baseUrl ?? "").replace(/\/$/, "");
const indexPath = join(dist, "index.html");

const headTags = [
  `<link rel="manifest" href="${base}/manifest.json">`,
  `<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">`,
  `<meta name="theme-color" content="#0A0A0A">`,
  `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
  `<meta name="apple-mobile-web-app-title" content="Teleprompter">`,
].join("\n    ");

const html = readFileSync(indexPath, "utf8")
  .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  .replace("</head>", `    ${headTags}\n  </head>`);
writeFileSync(indexPath, html);

// GitHub Pages serves 404.html for unknown paths; reuse the app so routing still works
copyFileSync(indexPath, join(dist, "404.html"));
// Pages' Jekyll step would drop the _expo folder
writeFileSync(join(dist, ".nojekyll"), "");

console.log(`Web build ready in ${dist}/ (base path: ${base || "/"})`);
