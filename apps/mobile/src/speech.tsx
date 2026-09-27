import { Square, Volume2 } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text } from "react-native";
import { API_URL, type MuseApi } from "./api";
import { fw } from "./locale";
import { useServerFeatures } from "./server-features";
import { persianVoice, pickSpeechMode, type SpeechMode } from "./speech-mode";
import { colors } from "./ui";

const web = Platform.OS === "web" && typeof window !== "undefined";
const synth = () => (web && "speechSynthesis" in window ? window.speechSynthesis : undefined);

function browserVoices() {
  return synth()?.getVoices() ?? [];
}

/** Voices load asynchronously in Chrome; re-read them when the list changes. */
function useVoices() {
  const [voices, setVoices] = useState(browserVoices);
  useEffect(() => {
    const speech = synth();
    if (!speech) return;
    const update = () => setVoices(speech.getVoices());
    speech.addEventListener("voiceschanged", update);
    return () => speech.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

export function useSpeechMode(): SpeechMode {
  const features = useServerFeatures();
  const voices = useVoices();
  return pickSpeechMode({
    web,
    ttsEnabled: features?.ttsEnabled === true,
    canPlayAudio: web && typeof Audio !== "undefined",
    voices,
  });
}

/** Only one answer is read at a time; starting another stops the previous one. */
let stopCurrent: (() => void) | undefined;
const audioUrls = new Map<string, string>();

async function serverAudio(api: MuseApi, text: string): Promise<string> {
  const cached = audioUrls.get(text);
  if (cached) return cached;
  const response = await fetch(`${API_URL}/api/tts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      typeof payload?.error === "string" ? payload.error : "ساخت صدا انجام نشد. دوباره تلاش کنید.",
    );
  }
  const url = URL.createObjectURL(await response.blob());
  if (audioUrls.size >= 20) {
    const [oldest, value] = audioUrls.entries().next().value as [string, string];
    URL.revokeObjectURL(value);
    audioUrls.delete(oldest);
  }
  audioUrls.set(text, url);
  return url;
}

const labelStyle = { fontSize: 13, lineHeight: 20, ...fw("500") };

/** «خواندن با صدا» under an assistant answer; hidden when neither server nor browser can speak. */
export function SpeakButton({ api, text }: { api: MuseApi; text: string }) {
  const mode = useSpeechMode();
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState("");
  const stopRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopRef.current?.(), []);
  if (!mode || !text.trim()) return null;

  const finish = () => {
    if (stopCurrent === stopRef.current) stopCurrent = undefined;
    stopRef.current = undefined;
    setState("idle");
  };

  function speakInBrowser() {
    const speech = synth();
    if (!speech) throw new Error("مرورگر شما خواندن با صدا را پشتیبانی نمی‌کند.");
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*_`#|>~]+/g, " "));
    const voice = persianVoice(speech.getVoices());
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "fa-IR";
    utterance.onend = finish;
    utterance.onerror = finish;
    stopRef.current = () => {
      utterance.onend = null;
      speech.cancel();
      finish();
    };
    stopCurrent = stopRef.current;
    speech.speak(utterance);
    setState("playing");
  }

  async function start() {
    stopCurrent?.();
    setError("");
    if (mode === "browser") {
      speakInBrowser();
      return;
    }
    setState("loading");
    try {
      const audio = new Audio(await serverAudio(api, text));
      audio.onended = finish;
      audio.onerror = finish;
      stopRef.current = () => {
        audio.pause();
        finish();
      };
      stopCurrent = stopRef.current;
      await audio.play();
      setState("playing");
    } catch (e) {
      setState("idle");
      // The server voice is unavailable: use the browser's Persian voice when there is one.
      if (persianVoice(browserVoices())) speakInBrowser();
      else setError(e instanceof Error ? e.message : "خواندن با صدا انجام نشد. دوباره تلاش کنید.");
    }
  }

  const playing = state === "playing";
  const label = playing ? "توقف خواندن" : "خواندن با صدا";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: state === "loading" }}
        disabled={state === "loading"}
        onPress={() => (playing ? stopRef.current?.() : void start())}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 14,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {state === "loading" ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : playing ? (
          <Square size={14} color={colors.muted} />
        ) : (
          <Volume2 size={15} color={colors.muted} />
        )}
        <Text style={[labelStyle, { color: colors.muted }]}>
          {state === "loading" ? "در حال آماده‌سازی صدا…" : label}
        </Text>
      </Pressable>
      {!!error && (
        <Text accessibilityRole="alert" style={[labelStyle, { color: colors.danger }]}>
          {error}
        </Text>
      )}
    </>
  );
}
