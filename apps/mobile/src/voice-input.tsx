import { Mic, Square } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { API_URL, type MuseApi } from "./api";
import { faDigits, fw } from "./locale";
import { colors } from "./ui";

/** Matches the server limit (TRANSCRIBE_MAX_BYTES); two minutes of opus is well below it. */
const MAX_SECONDS = 120;
/** whisper-1 on Metis accepts webm/ogg; MP4 (Safari) is transcribed through the Gemini fallback. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

type VoiceState = "idle" | "recording" | "transcribing";

function browserSupportsRecording() {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function microphoneError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "دسترسی به میکروفون داده نشد. از تنظیمات مرورگر اجازه دهید.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "میکروفونی پیدا نشد. یک میکروفون وصل کنید و دوباره تلاش کنید.";
  if (name === "NotReadableError")
    return "میکروفون در اختیار برنامهٔ دیگری است. آن را ببندید و دوباره تلاش کنید.";
  return "ضبط صدا شروع نشد. دوباره تلاش کنید.";
}

/**
 * Web-only voice dictation: records with MediaRecorder, uploads to /api/transcribe and hands
 * the text back for review. Unavailable on native builds and when the server disables it.
 */
export function useVoiceInput(api: MuseApi, onText: (text: string) => void) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    if (!browserSupportsRecording()) return;
    let active = true;
    fetch(`${API_URL}/api/health`)
      .then((response) => response.json())
      .then((health: { transcriptionEnabled?: boolean }) => {
        if (active) setAvailable(health.transcriptionEnabled === true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      const active = recorder.current;
      recorder.current = null;
      if (active && active.state !== "inactive") {
        active.onstop = null;
        active.stop();
        for (const track of active.stream.getTracks()) track.stop();
      }
    },
    [clearTimer],
  );

  const upload = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        const extension = blob.type.includes("mp4")
          ? "m4a"
          : blob.type.includes("ogg")
            ? "ogg"
            : "webm";
        form.append("file", blob, `recording.${extension}`);
        const { text } = await api.request<{ text: string }>("/api/transcribe", form);
        if (text.trim()) onTextRef.current(text.trim());
      } catch (e) {
        setError(e instanceof Error ? e.message : "تبدیل صدا به متن انجام نشد. دوباره تلاش کنید.");
      } finally {
        setState("idle");
      }
    },
    [api],
  );

  const stop = useCallback(() => {
    clearTimer();
    const active = recorder.current;
    if (active && active.state !== "inactive") active.stop();
  }, [clearTimer]);

  const start = useCallback(async () => {
    setError("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError(microphoneError(e));
      return;
    }
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    let media: MediaRecorder;
    try {
      media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      for (const track of stream.getTracks()) track.stop();
      setError(microphoneError(e));
      return;
    }
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
      const blob = new Blob(chunks, {
        type: (media.mimeType || mimeType || "audio/webm").split(";")[0],
      });
      if (blob.size === 0) {
        setState("idle");
        setError("صدایی ضبط نشد. دوباره تلاش کنید.");
        return;
      }
      void upload(blob);
    };
    recorder.current = media;
    media.start(1000);
    setSeconds(0);
    setState("recording");
    const started = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);
  }, [stop, upload]);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [start, state, stop]);

  return { available, state, seconds, error, toggle, dismissError: () => setError("") };
}

const clock = (value: number) =>
  faDigits(`${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`);

export function VoiceButton({
  state,
  onPress,
  disabled,
}: {
  state: VoiceState;
  onPress: () => void;
  disabled?: boolean;
}) {
  const recording = state === "recording";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        recording ? "پایان ضبط" : state === "transcribing" ? "تبدیل صدا به متن…" : "ضبط صدا"
      }
      accessibilityState={{ busy: state === "transcribing", disabled }}
      disabled={disabled || state === "transcribing"}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: recording ? colors.danger : pressed ? colors.sky : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {state === "transcribing" ? (
        <ActivityIndicator size="small" color={colors.blueDark} />
      ) : recording ? (
        <Square size={16} fill={colors.card} strokeWidth={0} />
      ) : (
        <Mic size={21} strokeWidth={1.8} color={colors.text} />
      )}
    </Pressable>
  );
}

/** One status line above the composer while recording, transcribing, or after an error. */
export function VoiceStatus({
  state,
  seconds,
  error,
}: {
  state: VoiceState;
  seconds: number;
  error: string;
}) {
  const text =
    state === "recording"
      ? `در حال ضبط… ${clock(seconds)} از ${clock(MAX_SECONDS)}؛ برای پایان، دکمهٔ توقف را بزنید.`
      : state === "transcribing"
        ? "تبدیل صدا به متن…"
        : error;
  if (!text) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={error && state === "idle" ? "alert" : undefined}
      style={{ paddingHorizontal: 10, paddingTop: 4 }}
    >
      <Text
        style={{
          fontSize: 12,
          lineHeight: 20,
          color: error && state === "idle" ? colors.danger : colors.muted,
          ...fw("400"),
        }}
      >
        {text}
      </Text>
    </View>
  );
}
