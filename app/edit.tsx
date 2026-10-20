import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScripts } from "@/contexts/ScriptsContext";
import { useColors } from "@/hooks/useColors";
import { confirmDestructive, notify } from "@/utils/dialogs";

function readingTime(wordCount: number): string {
  if (wordCount === 0) return "";
  const totalSec = Math.round((wordCount / 130) * 60);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `~${secs}s at 130 wpm`;
  if (secs === 0) return `~${mins}m at 130 wpm`;
  return `~${mins}m ${secs}s at 130 wpm`;
}

const TABLET_MAX_W = 720;

export default function EditScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string }>();
  const { getScript, createScript, updateScript, deleteScript } = useScripts();

  const existing = params.id ? getScript(params.id) : undefined;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const contentRef = useRef<TextInput>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  // Undo history — push the current content before every mutation
  const undoStackRef = useRef<string[]>([]);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const isTablet = width >= 768;
  const centered = isTablet
    ? ({ maxWidth: TABLET_MAX_W, alignSelf: "center" as const, width: "100%" as const })
    : {};

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    if (!existing && !params.id) {
      setTimeout(() => contentRef.current?.focus(), 300);
    }
  }, []);

  async function handleSave() {
    if (!content.trim()) {
      notify("Empty Script", "Please write some content before saving.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (existing) {
      await updateScript(existing.id, title, content);
    } else {
      await createScript(title, content);
    }
    router.back();
  }

  function handleDelete() {
    if (!existing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    confirmDestructive("Delete Script", `Delete "${existing.title}"?`, "Delete", async () => {
      await deleteScript(existing.id);
      router.back();
    });
  }

  // Push current content to undo stack (debounced — called on every keystroke)
  const scheduleUndoPush = useCallback((currentContent: string) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      undoStackRef.current.push(currentContent);
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    }, 400);
  }, []);

  // Push immediately before a toolbar mutation (not debounced)
  function pushUndo() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoStackRef.current.push(content);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
  }

  function handleUndo() {
    if (undoStackRef.current.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const prev = undoStackRef.current.pop()!;
    setContent(prev);
  }

  // Insert text at current cursor position
  function insertAtCursor(insert: string) {
    const { start, end } = selectionRef.current;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const next = before + insert + after;
    setContent(next);
    const newPos = start + insert.length;
    setTimeout(() => {
      contentRef.current?.setNativeProps({
        selection: { start: newPos, end: newPos },
      });
    }, 10);
  }

  function handleBold() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const len = content.length;
    // Clamp selection to current content length (guard against stale ref)
    const rawStart = Math.min(selectionRef.current.start, len);
    const rawEnd = Math.min(selectionRef.current.end, len);
    const start = Math.min(rawStart, rawEnd);
    const end = Math.max(rawStart, rawEnd);

    if (start !== end) {
      // Wrap selected text in ** markers
      const selected = content.slice(start, end);
      if (!selected.trim()) return;
      pushUndo();
      const next = content.slice(0, start) + `**${selected}**` + content.slice(end);
      setContent(next);
    } else {
      // No selection — expand to the word under the cursor
      const before = content.slice(0, start);
      const after = content.slice(start);
      const wordStartMatch = before.match(/\S+$/);
      const wordEndMatch = after.match(/^\S+/);
      const wordStart = wordStartMatch ? start - wordStartMatch[0].length : start;
      const wordEnd = wordEndMatch ? start + wordEndMatch[0].length : start;
      const word = content.slice(wordStart, wordEnd);
      if (!word.trim()) return;
      pushUndo();
      const next = content.slice(0, wordStart) + `**${word}**` + content.slice(wordEnd);
      setContent(next);
    }
  }

  function handleCapsToggle() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushUndo();
    const isAllCaps = content === content.toUpperCase();
    if (isAllCaps) {
      setContent(
        content
          .toLowerCase()
          .replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase())
      );
    } else {
      setContent(content.toUpperCase());
    }
  }

  function handleInsertPause() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushUndo();
    insertAtCursor("...");
  }

  function handleInsertBreak() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushUndo();
    insertAtCursor("\n\n");
  }

  function handleClear() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    confirmDestructive("Clear Script", "Remove all content?", "Clear", () => {
      pushUndo();
      setContent("");
    });
  }

  const canUndo = undoStackRef.current.length > 0;

  const toolbarItems: Array<{
    icon?: string;
    label: string;
    onPress: () => void;
    danger?: boolean;
    bold?: boolean;
    disabled?: boolean;
  }> = [
    { icon: "corner-up-left", label: "Undo", onPress: handleUndo, disabled: !canUndo },
    { icon: "type", label: "CAPS", onPress: handleCapsToggle },
    { label: "B", onPress: handleBold, bold: true },
    { label: "...", onPress: handleInsertPause },
    { label: "¶", onPress: handleInsertBreak },
    { icon: "trash-2", label: "", onPress: handleClear, danger: true },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topInset + 8, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Feather name="x" size={22} color={colors.mutedForeground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {existing ? "Edit Script" : "New Script"}
        </Text>
        <TouchableOpacity
          onPress={handleSave}
          hitSlop={12}
          style={[styles.saveBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
            Save
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          centered,
          { paddingBottom: bottomInset + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          style={[
            styles.titleInput,
            { color: colors.foreground, borderBottomColor: colors.border },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="Script title"
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="next"
          onSubmitEditing={() => contentRef.current?.focus()}
          blurOnSubmit={false}
          maxLength={100}
        />

        <TextInput
          ref={contentRef}
          style={[styles.contentInput, { color: colors.foreground }]}
          value={content}
          onChangeText={(text) => { setContent(text); scheduleUndoPush(text); }}
          placeholder="Write your script here. Use clear sentences and natural pauses for best results while recording…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          scrollEnabled={false}
          autoCorrect
          autoCapitalize="sentences"
          onSelectionChange={(e) => {
            selectionRef.current = e.nativeEvent.selection;
          }}
        />
      </ScrollView>

      {/* Formatting toolbar */}
      <View
        style={[
          styles.toolbar,
          { borderTopColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <View style={[styles.toolbarInner, centered]}>
        {toolbarItems.map((item, idx) => {
          const itemColor = item.danger
            ? colors.destructive
            : item.disabled
            ? colors.mutedForeground
            : colors.foreground;
          return (
            <TouchableOpacity
              key={idx}
              onPress={item.disabled ? undefined : item.onPress}
              style={[
                styles.toolbarBtn,
                {
                  borderColor: item.danger
                    ? colors.destructive + "44"
                    : colors.border,
                  opacity: item.disabled ? 0.35 : 1,
                },
              ]}
              hitSlop={8}
              activeOpacity={item.disabled ? 1 : 0.6}
            >
              {item.icon ? (
                <Feather name={item.icon as any} size={15} color={itemColor} />
              ) : null}
              {item.label ? (
                <Text
                  style={[
                    styles.toolbarLabel,
                    {
                      color: itemColor,
                      marginLeft: item.icon ? 4 : 0,
                      fontFamily: item.bold ? "Inter_700Bold" : "Inter_600SemiBold",
                    },
                  ]}
                >
                  {item.label}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}

        <View style={styles.toolbarSpacer} />

        {/* Word count + reading time */}
        <View style={styles.countBlock}>
          <Text style={[styles.countMain, { color: colors.foreground }]}>
            {wordCount} words
          </Text>
          {wordCount > 0 && (
            <Text style={[styles.countSub, { color: colors.mutedForeground }]}>
              {readingTime(wordCount)}
            </Text>
          )}
        </View>
        </View>{/* /toolbarInner */}
      </View>

      {/* Footer (delete) */}
      <View
        style={[
          styles.footer,
          { paddingBottom: bottomInset + 12, borderTopColor: colors.border },
        ]}
      >
        <View style={centered}>
          {existing && (
            <TouchableOpacity onPress={handleDelete} hitSlop={8} style={styles.deleteRow}>
              <Feather name="trash-2" size={15} color={colors.destructive} />
              <Text style={[styles.deleteLabel, { color: colors.destructive }]}>
                Delete script
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },
  titleInput: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
    letterSpacing: -0.3,
  },
  contentInput: {
    fontSize: 17,
    fontFamily: "Inter_400Regular",
    lineHeight: 28,
    minHeight: 300,
  },
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  toolbarBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  toolbarLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  toolbarSpacer: { flex: 1 },
  countBlock: { alignItems: "flex-end" },
  countMain: { fontSize: 12, fontFamily: "Inter_500Medium" },
  countSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 20,
  },
  deleteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  deleteLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
