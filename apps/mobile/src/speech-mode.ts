/** How «خواندن با صدا» plays an answer: server audio, the browser's own voice, or not at all. */
export type SpeechMode = "server" | "browser" | null;

type Voice = { lang: string; name: string };

/** A Persian voice from speechSynthesis.getVoices(), preferring fa-IR. */
export function persianVoice<T extends Voice>(voices: readonly T[]): T | undefined {
  const lang = (voice: T) => voice.lang.toLowerCase().replace("_", "-");
  return (
    voices.find((voice) => lang(voice) === "fa-ir") ??
    voices.find((voice) => lang(voice).startsWith("fa")) ??
    voices.find((voice) => /persian|farsi/i.test(voice.name))
  );
}

export function pickSpeechMode(options: {
  web: boolean;
  ttsEnabled: boolean;
  canPlayAudio: boolean;
  voices: readonly Voice[];
}): SpeechMode {
  if (!options.web) return null;
  if (options.ttsEnabled && options.canPlayAudio) return "server";
  return persianVoice(options.voices) ? "browser" : null;
}
