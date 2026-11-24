// Google Analytics 4. Empty ID = nothing is loaded and no cookies are set.
// Page views, SPA route changes (history) and outbound link clicks come from GA4 Enhanced Measurement;
// app.js adds a few named events through window.gtag (ask_agent, open_competition, submit_competition).
const GA_ID = "G-W2QD0XKKEY";

if (/^G-[A-Z0-9]+$/.test(GA_ID)) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

// Vercel Web Analytics: cookieless page views, SPA route changes included. This is what inject() from
// @vercel/analytics does; the site has no bundler, so it is inlined here (CSP blocks inline scripts).
// Served by Vercel only when Web Analytics is enabled for the project; skipped on the local dev server.
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  window.va = window.va || function va() { (window.vaq = window.vaq || []).push(arguments); };
  const v = document.createElement("script");
  v.defer = true;
  v.src = "/_vercel/insights/script.js";
  document.head.appendChild(v);
}
