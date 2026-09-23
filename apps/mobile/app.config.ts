import type { ExpoConfig } from "expo/config";
// Brand lives in one place (packages/domain/src/brand.json); see docs/REBRAND.md.
// Expo transpiles only this file, so it reads the JSON rather than brand.ts.
import brand from "../../packages/domain/src/brand.json";

const config: ExpoConfig = {
  name: brand.nameFa,
  // Technical identifiers: changing slug/scheme/bundle ids breaks existing installs,
  // deep links and store listings. Keep them stable unless deliberately migrating.
  slug: brand.technical.slug,
  scheme: brand.technical.scheme,
  version: "0.1.0",
  orientation: "default",
  // Follows the system light/dark setting (see src/theme.ts).
  userInterfaceStyle: "automatic",
  // Icons are rendered from assets/brand/*.svg by scripts/generate-icons.mjs.
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: brand.technical.iosBundleIdentifier,
  },
  android: {
    package: brand.technical.androidPackage,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#1B74CC",
    },
  },
  web: {
    bundler: "metro",
    name: `${brand.nameFa} | ${brand.tagline}`,
    shortName: brand.nameFa,
    lang: "fa",
    dir: "rtl",
    favicon: "./assets/favicon.png",
    backgroundColor: "#FCFCFC",
  },
  plugins: [
    // SDK 57 removed the top-level `splash` field; the splash lives in its plugin.
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#FCFCFC",
      },
    ],
    "expo-document-picker",
    "@config-plugins/react-native-blob-util",
    "@config-plugins/react-native-pdf",
    "expo-font",
  ],
};

export default config;
