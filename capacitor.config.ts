import type { CapacitorConfig } from '@capacitor/cli';

// This app loads metersahi.in directly over the network, rather than
// bundling a frozen local copy of the site inside the APK. That means
// every future update to the website (new cities, bug fixes, the
// feedback dialog, anything) reaches the app automatically - no new
// app-store release needed for web-side changes. A rebuild is only
// needed if something at the NATIVE level changes (permissions, icon,
// app name, splash screen).
const config: CapacitorConfig = {
  appId: 'in.metersahi.app',
  appName: 'MeterSahi?',
  webDir: 'www',
  server: {
    url: 'https://metersahi.in/?utm_source=android_app&utm_medium=app',
    cleartext: false,
    // Origins the WebView is allowed to navigate to, beyond the main
    // server.url itself - covers everything the site actually talks
    // to (Google Maps/Routes/Places, Supabase, Analytics, the Tabler
    // icon font CDN). Subresource loads (scripts, fetch/XHR) aren't
    // gated by this the same way top-level navigation is, but it's
    // included for completeness and to avoid surprises.
    allowNavigation: [
      'metersahi.in',
      '*.metersahi.in',
      '*.googleapis.com',
      '*.google.com',
      '*.gstatic.com',
      '*.supabase.co',
      '*.google-analytics.com',
      '*.googletagmanager.com',
      '*.analytics.google.com',
      'cdn.jsdelivr.net',
    ],
  },
  android: {
    // Ensures cookies/localStorage behave like a normal https site
    // (matters for the feedback-dialog suppression logic, which uses
    // localStorage).
    allowMixedContent: false,
  },
};

export default config;
