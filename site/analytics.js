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
