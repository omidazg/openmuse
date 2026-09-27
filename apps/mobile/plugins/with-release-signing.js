// Signs Android release builds with the upload key from the environment (set by
// .github/workflows/android.yml from repository secrets). Without these variables a release build
// keeps React Native's debug signing, which is fine locally but must never be distributed.
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_CONFIG = `
        release {
            if (System.getenv("DASTYAR_KEYSTORE_FILE")) {
                storeFile file(System.getenv("DASTYAR_KEYSTORE_FILE"))
                storeType "pkcs12"
                storePassword System.getenv("DASTYAR_KEYSTORE_PASSWORD")
                keyAlias System.getenv("DASTYAR_KEY_ALIAS")
                keyPassword System.getenv("DASTYAR_KEYSTORE_PASSWORD")
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes("DASTYAR_KEYSTORE_FILE")) return mod;
    const signing = gradle.indexOf("signingConfigs {");
    const buildTypes = gradle.indexOf("buildTypes {");
    if (signing < 0 || buildTypes < 0)
      throw new Error("with-release-signing: unexpected android/app/build.gradle layout");
    const insertAt = signing + "signingConfigs {".length;
    gradle = gradle.slice(0, insertAt) + RELEASE_CONFIG + gradle.slice(insertAt);
    // Point the release build type (the one after `buildTypes {`) at the new config.
    const releaseType = gradle.indexOf("release {", gradle.indexOf("buildTypes {"));
    const debugSigning = gradle.indexOf("signingConfig signingConfigs.debug", releaseType);
    if (releaseType < 0 || debugSigning < 0)
      throw new Error("with-release-signing: release build type not found in build.gradle");
    gradle =
      gradle.slice(0, debugSigning) +
      'signingConfig System.getenv("DASTYAR_KEYSTORE_FILE") ? signingConfigs.release : signingConfigs.debug' +
      gradle.slice(debugSigning + "signingConfig signingConfigs.debug".length);
    mod.modResults.contents = gradle;
    return mod;
  });
};
