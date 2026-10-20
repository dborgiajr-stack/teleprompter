import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, VideoQuality } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import * as MediaLibrary from "expo-media-library";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

// ── Camera quality / bitrate option tables ─────────────────────────────────
const QUALITY_OPTIONS: Array<{
  label: string;
  sub: string;
  value: VideoQuality;
}> = [
  { label: "4K", sub: "2160p · up to 30fps", value: "2160p" },
  { label: "1080p", sub: "Full HD · up to 60fps", value: "1080p" },
  { label: "720p", sub: "HD · up to 60fps", value: "720p" },
  { label: "480p", sub: "SD · up to 30fps", value: "480p" },
];

const BITRATE_OPTIONS: Array<{ label: string; sub: string; value: number }> = [
  { label: "Low", sub: "5 Mbps", value: 5_000_000 },
  { label: "Medium", sub: "10 Mbps", value: 10_000_000 },
  { label: "High", sub: "25 Mbps", value: 25_000_000 },
  { label: "Ultra", sub: "50 Mbps", value: 50_000_000 },
];
import { useSafeAreaInsets } from "react-native-safe-area-context"; // eslint-disable-line import/order

import { WebCamera, type WebCameraHandle } from "@/components/WebCamera";
import { useScripts } from "@/contexts/ScriptsContext";
import { useColors } from "@/hooks/useColors";
import { notify } from "@/utils/dialogs";
// ───────────────────────────────────────────────────────────────────────────

const FONT_SIZES = [20, 28, 38, 52, 68] as const;
const INTERVAL_MS = 16;
const FOCUS_RATIO = 0.38;

function getStep(speed: number): number {
  return speed * 0.28;
}

interface WordLine {
  lineY: number;
  lineHeight: number;
  wordsOnLine: number;
  startWordIndex: number;
}

export default function PlayScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const { getScript } = useScripts();
  const script = getScript(params.id ?? "");

  // Split content into words (spaces become {" "} separators in JSX)
  // Parse **bold** markers — each token carries display text + bold flag
  const wordTokens = useMemo(() => {
    const raw = script?.content ?? "";
    const tokens: { text: string; bold: boolean }[] = [];
    const regex = /\*\*(.+?)\*\*|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(raw)) !== null) {
      if (m[1] !== undefined) {
        // bold segment — may contain multiple words
        m[1].split(/\s+/).filter(Boolean).forEach((w) => tokens.push({ text: w, bold: true }));
      } else if (m[2]) {
        tokens.push({ text: m[2], bold: false });
      }
    }
    return tokens;
  }, [script?.content]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [fontSizeIndex, setFontSizeIndex] = useState(1);
  const [mirrored, setMirrored] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [finished, setFinished] = useState(false);
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [activeLine, setActiveLine] = useState<{ localY: number; height: number } | null>(null);
  const [containerH, setContainerH] = useState(0);

  const [cameraMode, setCameraMode] = useState(false);
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [isRecording, setIsRecording] = useState(false);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("1080p");
  const [videoBitrate, setVideoBitrate] = useState(10_000_000);
  const [showCameraSettings, setShowCameraSettings] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  // Distinguish taps from scroll gestures — set true as soon as a drag starts
  const didScrollRef = useRef(false);
  const speedRef = useRef(speed);
  const isPlayingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const wasPlayingBeforeDragRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const recordPulse = useRef(new Animated.Value(1)).current;
  const cameraRef = useRef<CameraView>(null);
  const webCameraRef = useRef<WebCameraHandle>(null);
  // Word-line map: each entry covers a visual line and its word range
  const wordLinesRef = useRef<WordLine[]>([]);
  const textContainerYRef = useRef(0);
  const activeWordIndexRef = useRef(0);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { activeWordIndexRef.current = activeWordIndex; }, [activeWordIndex]);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordPulse, { toValue: 0.4, duration: 600, useNativeDriver: true }),
          Animated.timing(recordPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      recordPulse.stopAnimation();
      recordPulse.setValue(1);
    }
  }, [isRecording, recordPulse]);

  // Called on every scroll tick — finds the active word by:
  //  1. Finding which visual line is at the focus Y
  //  2. Computing how far through that line we are → which word within the line
  const computeActiveWord = useCallback((scrollY: number, cHeight: number) => {
    const wordLines = wordLinesRef.current;
    if (!wordLines.length) return;

    // focusY relative to the Text component itself (subtract containerY + paddingTop)
    const focusY = scrollY + cHeight * FOCUS_RATIO - textContainerYRef.current;

    // Find which line contains the focus
    let lineIdx = 0;
    for (let i = 0; i < wordLines.length; i++) {
      if (wordLines[i].lineY <= focusY) lineIdx = i;
      else break;
    }

    const line = wordLines[lineIdx];
    if (!line) return;

    // Progress through this line: 0 → first word, 1 → last word
    const lineProgress = Math.max(
      0,
      Math.min(1, (focusY - line.lineY) / Math.max(line.lineHeight, 1))
    );
    const wordInLine = Math.min(
      Math.floor(lineProgress * line.wordsOnLine),
      line.wordsOnLine - 1
    );
    const newWordIdx = line.startWordIndex + wordInLine;

    if (newWordIdx !== activeWordIndexRef.current) {
      setActiveWordIndex(newWordIdx);
      // Also update the line highlight position
      setActiveLine({ localY: line.lineY, height: line.lineHeight });
    }
  }, []);

  const showControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setControlsVisible(true);
  }, [controlsOpacity]);

  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 500, useNativeDriver: true })
        .start(() => setControlsVisible(false));
    }, 3000);
  }, [controlsOpacity]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const startInterval = useCallback(() => {
    stopInterval();
    intervalRef.current = setInterval(() => {
      if (!isPlayingRef.current) return;
      const maxScroll = contentHeightRef.current - containerHeightRef.current;
      if (maxScroll <= 0) return;
      const next = Math.min(scrollYRef.current + getStep(speedRef.current), maxScroll);
      scrollYRef.current = next;
      scrollViewRef.current?.scrollTo({ y: next, animated: false });
      setProgress(next / maxScroll);
      computeActiveWord(next, containerHeightRef.current);
      if (next >= maxScroll) {
        stopInterval();
        isPlayingRef.current = false;
        setIsPlaying(false);
        setFinished(true);
        showControls();
        if (isRecordingRef.current) cameraRef.current?.stopRecording();
      }
    }, INTERVAL_MS);
  }, [stopInterval, showControls, computeActiveWord]);

  const handlePlayPause = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFinished(false);
    setIsPlaying((prev) => {
      const next = !prev;
      isPlayingRef.current = next;
      if (next) { startInterval(); scheduleHideControls(); }
      else { stopInterval(); showControls(); }
      return next;
    });
  }, [startInterval, stopInterval, showControls, scheduleHideControls]);

  const handleRestart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopInterval();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setFinished(false);
    setActiveWordIndex(0);
    setActiveLine(wordLinesRef.current[0]
      ? { localY: wordLinesRef.current[0].lineY, height: wordLinesRef.current[0].lineHeight }
      : null
    );
    scrollYRef.current = 0;
    setProgress(0);
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    showControls();
  }, [stopInterval, showControls]);

  const handleScreenTap = useCallback(() => {
    if (controlsVisible) {
      if (isPlaying) {
        Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true })
          .start(() => setControlsVisible(false));
      }
    } else {
      showControls();
      if (isPlaying) scheduleHideControls();
    }
  }, [controlsVisible, isPlaying, controlsOpacity, showControls, scheduleHideControls]);

  const handleScrollBeginDrag = useCallback(() => {
    didScrollRef.current = true; // mark that this touch is a scroll, not a tap
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    if (!isPlayingRef.current) return;
    wasPlayingBeforeDragRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopInterval();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setFinished(false);
    showControls();
  }, [stopInterval, showControls]);

  const handleScrollEndDrag = useCallback(() => {
    if (!wasPlayingBeforeDragRef.current) return;
    wasPlayingBeforeDragRef.current = false;
    resumeTimerRef.current = setTimeout(() => {
      isPlayingRef.current = true;
      setIsPlaying(true);
      startInterval();
      scheduleHideControls();
    }, 1000);
  }, [startInterval, scheduleHideControls]);

  const handleToggleOrientation = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web") return;
    try {
      if (!isLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
        setIsLandscape(true);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        setIsLandscape(false);
      }
    } catch {
      // lock failed — leave state as-is so a retry works
    }
  }, [isLandscape]);

  const handleToggleCamera = useCallback(async () => {
    if (!cameraMode) {
      if (Platform.OS !== "web" && !cameraPermission?.granted) {
        const result = await requestCameraPermission();
        if (!result.granted) {
          notify("Camera permission needed", "Allow camera access in Settings to use this feature.");
          return;
        }
      }
    } else {
      if (isRecordingRef.current) {
        cameraRef.current?.stopRecording();
        webCameraRef.current?.stopRecording();
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCameraMode((prev) => !prev);
  }, [cameraMode, cameraPermission, requestCameraPermission]);

  const handleRecord = useCallback(async () => {
    if (Platform.OS === "web") {
      if (!webCameraRef.current) return;
      if (isRecordingRef.current) { webCameraRef.current.stopRecording(); return; }
      setIsRecording(true);
      try {
        await webCameraRef.current.recordAsync();
      } catch (e) {
        notify("Recording failed", (e as Error).message);
      } finally {
        setIsRecording(false);
      }
      return;
    }
    if (!cameraRef.current) return;
    if (isRecordingRef.current) { cameraRef.current.stopRecording(); return; }
    if (!mediaPermission?.granted) {
      const result = await requestMediaPermission();
      if (!result.granted) {
        notify("Permission needed", "Allow access to your photo library to save recordings.");
        return;
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsRecording(true);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 7200 });
      if (video?.uri) {
        await MediaLibrary.saveToLibraryAsync(video.uri);
        notify("Saved", "Your recording has been saved to the camera roll.");
      }
    } catch { /* stopped or cancelled */ } finally {
      setIsRecording(false);
    }
  }, [mediaPermission, requestMediaPermission]);

  useEffect(() => {
    return () => {
      stopInterval();
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      if (isRecordingRef.current) {
        cameraRef.current?.stopRecording();
        webCameraRef.current?.stopRecording();
      }
      // Always restore portrait when leaving the teleprompter screen
      if (Platform.OS !== "web") {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      }
    };
  }, [stopInterval]);

  const handleWebCameraError = useCallback((message: string) => {
    setCameraMode(false);
    notify("Camera unavailable", message);
  }, []);

  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const PLAY_MAX_W = 820;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const fontSize = FONT_SIZES[fontSizeIndex];
  const lineHeight = fontSize * 1.55;

  if (!script) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.foreground }]}>Script not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.errorBack, { color: colors.primary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: "#000000" }]}>
      {cameraMode && Platform.OS !== "web" && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="video"
          videoQuality={videoQuality}
          videoBitrate={videoBitrate}
        />
      )}
      {cameraMode && Platform.OS === "web" && (
        <WebCamera
          ref={webCameraRef}
          facing={facing}
          videoQuality={videoQuality}
          videoBitrate={videoBitrate}
          onError={handleWebCameraError}
        />
      )}
      {cameraMode && <View style={styles.cameraOverlay} pointerEvents="none" />}

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            // paddingTop puts the first line exactly at the focus point (38% down)
            // paddingBottom lets the last line scroll up to the same focus point
            paddingTop: containerH > 0 ? containerH * FOCUS_RATIO : topInset + 60,
            paddingBottom: containerH > 0 ? containerH * (1 - FOCUS_RATIO) + bottomInset + 16 : bottomInset + 140,
            paddingHorizontal: 28,
          },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onContentSizeChange={(_, h) => { contentHeightRef.current = h; }}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          containerHeightRef.current = h;
          setContainerH(h);
        }}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          scrollYRef.current = y;
          const max = contentHeightRef.current - containerHeightRef.current;
          if (max > 0) setProgress(y / max);
          computeActiveWord(y, containerHeightRef.current);
        }}
        scrollEventThrottle={50}
        onTouchStart={() => { didScrollRef.current = false; }}
        onTouchEnd={() => { if (!didScrollRef.current) handleScreenTap(); }}
      >
        <View
          onLayout={(e) => {
            textContainerYRef.current = e.nativeEvent.layout.y;
          }}
          style={isTablet ? { maxWidth: PLAY_MAX_W, alignSelf: "center" as const, width: "100%" as const } : undefined}
        >
          {/* Line highlight background — drawn behind text, outside mirror transform */}
          {activeLine && (
            <View
              style={[
                styles.lineHighlight,
                {
                  top: activeLine.localY,
                  height: activeLine.height,
                  backgroundColor: colors.primary + "1A",
                  borderLeftColor: colors.primary,
                },
              ]}
              pointerEvents="none"
            />
          )}

          {/* Text with per-word colour spans — mirrored separately */}
          <View style={mirrored ? styles.mirrored : undefined}>
            <Text
              style={[styles.scriptText, { fontSize, lineHeight }]}
              onTextLayout={(e) => {
                // Build the word-line map from actual rendered line data
                let globalWordIdx = 0;
                wordLinesRef.current = e.nativeEvent.lines.map((line) => {
                  const wordsOnLine = line.text
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length;
                  const entry: WordLine = {
                    lineY: line.y,
                    lineHeight: line.height,
                    wordsOnLine: Math.max(wordsOnLine, 1),
                    startWordIndex: globalWordIdx,
                  };
                  globalWordIdx += entry.wordsOnLine;
                  return entry;
                });
                // Initialise highlight to first line
                if (wordLinesRef.current.length > 0 && !activeLine) {
                  const first = wordLinesRef.current[0];
                  setActiveLine({ localY: first.lineY, height: first.lineHeight });
                }
              }}
            >
              {wordTokens.map((token, i) => {
                const isActiveWord = i === activeWordIndex;
                const lineForWord = wordLinesRef.current.find(
                  (wl) =>
                    i >= wl.startWordIndex &&
                    i < wl.startWordIndex + wl.wordsOnLine
                );
                const isOnActiveLine =
                  activeLine &&
                  lineForWord &&
                  Math.abs(lineForWord.lineY - activeLine.localY) < 2;

                const wordColor = isActiveWord
                  ? colors.primary
                  : isOnActiveLine
                  ? "#F0EDE8"
                  : "rgba(240,237,232,0.4)";

                return (
                  <Text
                    key={i}
                    style={[
                      { color: wordColor },
                      token.bold && { fontFamily: "Inter_700Bold" },
                    ]}
                  >
                    {token.text}
                    {i < wordTokens.length - 1 ? " " : ""}
                  </Text>
                );
              })}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Camera settings panel ─────────────────────────────────────────── */}
      {showCameraSettings && (
        <View style={[styles.settingsPanel, { paddingBottom: bottomInset + 16 }]}>
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>Camera Settings</Text>
            <TouchableOpacity
              onPress={() => setShowCameraSettings(false)}
              hitSlop={12}
            >
              <Feather name="x" size={20} color="rgba(240,237,232,0.8)" />
            </TouchableOpacity>
          </View>

          {/* Quality */}
          <Text style={styles.settingsSectionLabel}>Quality</Text>
          <View style={styles.settingsOptions}>
            {QUALITY_OPTIONS.map((opt) => {
              const active = videoQuality === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setVideoQuality(opt.value);
                  }}
                  style={[
                    styles.settingsOption,
                    {
                      backgroundColor: active
                        ? "rgba(232,160,32,0.18)"
                        : "rgba(255,255,255,0.06)",
                      borderColor: active
                        ? "rgba(232,160,32,0.7)"
                        : "rgba(255,255,255,0.12)",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsOptionLabel,
                      { color: active ? "#E8A020" : "#F0EDE8" },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.settingsOptionSub}>{opt.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Bitrate */}
          <Text style={styles.settingsSectionLabel}>Bitrate</Text>
          <View style={styles.settingsOptions}>
            {BITRATE_OPTIONS.map((opt) => {
              const active = videoBitrate === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setVideoBitrate(opt.value);
                  }}
                  style={[
                    styles.settingsOption,
                    {
                      backgroundColor: active
                        ? "rgba(232,160,32,0.18)"
                        : "rgba(255,255,255,0.06)",
                      borderColor: active
                        ? "rgba(232,160,32,0.7)"
                        : "rgba(255,255,255,0.12)",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsOptionLabel,
                      { color: active ? "#E8A020" : "#F0EDE8" },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.settingsOptionSub}>{opt.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.settingsNote}>
            Settings take effect on next recording. 4K requires rear camera on most devices.
          </Text>
        </View>
      )}

      {isRecording && (
        <View style={styles.recBadge} pointerEvents="none">
          <Animated.View style={[styles.recDot, { opacity: recordPulse }]} />
          <Text style={styles.recLabel}>REC</Text>
        </View>
      )}

      {finished && !isRecording && (
        <View style={styles.finishedBadge} pointerEvents="none">
          <View style={[styles.finishedPill, { backgroundColor: colors.primary }]}>
            <Text style={[styles.finishedText, { color: colors.primaryForeground }]}>
              Script complete
            </Text>
          </View>
        </View>
      )}

      <Animated.View
        style={[styles.overlay, { opacity: controlsOpacity }]}
        pointerEvents={controlsVisible ? "box-none" : "none"}
      >
        <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
          <TouchableOpacity
            onPress={() => {
              stopInterval();
              if (isRecordingRef.current) cameraRef.current?.stopRecording();
              router.back();
            }}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Feather name="chevron-left" size={24} color="rgba(240,237,232,0.8)" />
          </TouchableOpacity>

          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(progress * 100, 100)}%` as any, backgroundColor: colors.primary },
                ]}
              />
            </View>
            <Text style={styles.progressPct}>{Math.round(progress * 100)}%</Text>
          </View>

          <Text style={styles.scriptTitle} numberOfLines={1}>{script.title}</Text>
        </View>

        <View
          pointerEvents="auto"
          style={[
            styles.bottomControls,
            { paddingBottom: bottomInset + 16 },
            isTablet && { maxWidth: PLAY_MAX_W, alignSelf: "center" as const, width: "100%" as const },
          ]}
        >
          <View style={styles.toggleRow}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMirrored((m) => !m); }}
              style={[
                styles.toggleBtn,
                {
                  backgroundColor: mirrored ? colors.primary + "33" : "rgba(255,255,255,0.08)",
                  borderColor: mirrored ? colors.primary : "transparent",
                },
              ]}
            >
              <Feather name="repeat" size={16} color={mirrored ? colors.primary : "rgba(240,237,232,0.7)"} />
              <Text style={[styles.toggleLabel, { color: mirrored ? colors.primary : "rgba(240,237,232,0.7)" }]}>
                Mirror
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setFontSizeIndex((i) => (i + 1) % FONT_SIZES.length);
              }}
              style={[styles.toggleBtn, { backgroundColor: "rgba(255,255,255,0.08)" }]}
            >
              <Feather name="type" size={16} color="rgba(240,237,232,0.7)" />
              <Text style={[styles.toggleLabel, { color: "rgba(240,237,232,0.7)" }]}>{fontSize}pt</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleToggleCamera}
              style={[
                styles.toggleBtn,
                {
                  backgroundColor: cameraMode ? "#E8404033" : "rgba(255,255,255,0.08)",
                  borderColor: cameraMode ? "#E84040" : "transparent",
                },
              ]}
            >
              <Feather name="camera" size={16} color={cameraMode ? "#E84040" : "rgba(240,237,232,0.7)"} />
              <Text style={[styles.toggleLabel, { color: cameraMode ? "#E84040" : "rgba(240,237,232,0.7)" }]}>
                Camera
              </Text>
            </TouchableOpacity>

            {Platform.OS !== "web" && (
              <TouchableOpacity
                onPress={handleToggleOrientation}
                style={[
                  styles.toggleBtn,
                  {
                    backgroundColor: isLandscape ? colors.primary + "33" : "rgba(255,255,255,0.08)",
                    borderColor: isLandscape ? colors.primary : "transparent",
                  },
                ]}
              >
                <Feather
                  name={isLandscape ? "smartphone" : "monitor"}
                  size={16}
                  color={isLandscape ? colors.primary : "rgba(240,237,232,0.7)"}
                />
                <Text style={[styles.toggleLabel, { color: isLandscape ? colors.primary : "rgba(240,237,232,0.7)" }]}>
                  {isLandscape ? "Wide" : "Tall"}
                </Text>
              </TouchableOpacity>
            )}

            {cameraMode && (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setFacing((f) => (f === "front" ? "back" : "front"));
                }}
                style={[styles.toggleBtn, { backgroundColor: "rgba(255,255,255,0.08)" }]}
              >
                <Feather name="refresh-cw" size={16} color="rgba(240,237,232,0.7)" />
              </TouchableOpacity>
            )}

            {cameraMode && (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowCameraSettings((v) => !v);
                }}
                style={[
                  styles.toggleBtn,
                  {
                    backgroundColor: showCameraSettings
                      ? colors.primary + "33"
                      : "rgba(255,255,255,0.08)",
                    borderColor: showCameraSettings ? colors.primary : "transparent",
                  },
                ]}
              >
                <Feather
                  name="settings"
                  size={16}
                  color={showCameraSettings ? colors.primary : "rgba(240,237,232,0.7)"}
                />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.speedRow}>
            <Text style={styles.speedRowLabel}>Speed</Text>
            <View style={styles.speedControls}>
              <TouchableOpacity
                onPress={() => {
                  const next = Math.max(1, speed - 0.5);
                  setSpeed(next);
                  speedRef.current = next;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                hitSlop={8}
                style={[styles.speedBtn, { borderColor: "rgba(255,255,255,0.2)" }]}
              >
                <Feather name="minus" size={16} color="rgba(240,237,232,0.8)" />
              </TouchableOpacity>
              <Text style={[styles.speedValue, { color: colors.primary }]}>{speed.toFixed(1)}×</Text>
              <TouchableOpacity
                onPress={() => {
                  const next = Math.min(10, speed + 0.5);
                  setSpeed(next);
                  speedRef.current = next;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                hitSlop={8}
                style={[styles.speedBtn, { borderColor: "rgba(255,255,255,0.2)" }]}
              >
                <Feather name="plus" size={16} color="rgba(240,237,232,0.8)" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.mainControls}>
            <TouchableOpacity onPress={handleRestart} hitSlop={12} style={styles.sideCtrl}>
              <Feather name="skip-back" size={22} color="rgba(240,237,232,0.7)" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePlayPause}
              style={[styles.playBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.8}
            >
              <Feather
                name={isPlaying ? "pause" : "play"}
                size={28}
                color={colors.primaryForeground}
                style={isPlaying ? undefined : { marginLeft: 3 }}
              />
            </TouchableOpacity>

            {cameraMode ? (
              <TouchableOpacity onPress={handleRecord} style={styles.sideCtrl} hitSlop={8}>
                <View style={[styles.recordBtn, { borderColor: isRecording ? "#E84040" : "rgba(255,255,255,0.4)" }]}>
                  <Animated.View
                    style={[
                      styles.recordInner,
                      { backgroundColor: "#E84040", borderRadius: isRecording ? 4 : 10, opacity: isRecording ? recordPulse : 1 },
                    ]}
                  />
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.sideCtrl} />
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.38)" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  mirrored: { transform: [{ scaleX: -1 }] },
  lineHighlight: {
    position: "absolute",
    left: -4,
    right: -4,
    borderRadius: 4,
    borderLeftWidth: 3,
  },
  scriptText: {
    fontFamily: "Inter_400Regular",
    letterSpacing: 0.2,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    pointerEvents: "box-none",
  },
  topBar: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  backBtn: { alignSelf: "flex-start", padding: 4 },
  progressContainer: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: {
    flex: 1, height: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2, overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 2 },
  progressPct: {
    fontSize: 11, fontFamily: "Inter_500Medium",
    color: "rgba(240,237,232,0.5)", width: 32, textAlign: "right",
  },
  scriptTitle: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(240,237,232,0.4)" },
  bottomControls: {
    paddingHorizontal: 20, paddingTop: 16, gap: 14,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  toggleRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  toggleBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
  },
  toggleLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  speedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  speedRowLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(240,237,232,0.5)" },
  speedControls: { flexDirection: "row", alignItems: "center", gap: 16 },
  speedBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  speedValue: { fontSize: 17, fontFamily: "Inter_700Bold", minWidth: 44, textAlign: "center" },
  mainControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 4 },
  sideCtrl: { width: 48, alignItems: "center" },
  playBtn: {
    width: 68, height: 68, borderRadius: 34,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#E8A020", shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 16, elevation: 8,
  },
  recordBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  recordInner: { width: 20, height: 20 },
  recBadge: {
    position: "absolute", top: 60, right: 20,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E84040" },
  recLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#E84040", letterSpacing: 1 },
  finishedBadge: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  finishedPill: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 30 },
  finishedText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  errorBack: { fontSize: 16, fontFamily: "Inter_500Medium" },
  // ── Camera settings panel ────────────────────────────────────────────────
  settingsPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(14,14,14,0.97)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingTop: 20,
    paddingHorizontal: 20,
    zIndex: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  settingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  settingsTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: "#F0EDE8",
  },
  settingsSectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(240,237,232,0.45)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  settingsOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  settingsOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 72,
    alignItems: "center",
  },
  settingsOptionLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  settingsOptionSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(240,237,232,0.4)",
  },
  settingsNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(240,237,232,0.35)",
    lineHeight: 17,
    marginBottom: 8,
  },
});
