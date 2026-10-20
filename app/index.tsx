import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScripts, type Script } from "@/contexts/ScriptsContext";
import { useColors } from "@/hooks/useColors";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function ScriptCard({ script }: { script: Script }) {
  const colors = useColors();
  const { deleteScript } = useScripts();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/play", params: { id: script.id } });
  }

  function handleEdit() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/edit", params: { id: script.id } });
  }

  function handleDelete() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Delete Script", `Delete "${script.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteScript(script.id),
      },
    ]);
  }

  const preview = script.content.trim().replace(/\s+/g, " ").slice(0, 90);
  const words = wordCount(script.content);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <Text
            style={[styles.cardTitle, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {script.title}
          </Text>
          <Text
            style={[styles.cardMeta, { color: colors.mutedForeground }]}
          >
            {words} words · {timeAgo(script.updatedAt)}
          </Text>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity
            onPress={handleEdit}
            hitSlop={8}
            style={styles.actionBtn}
          >
            <Feather name="edit-2" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={8}
            style={styles.actionBtn}
          >
            <Feather name="trash-2" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>
      {preview.length > 0 && (
        <Text
          style={[styles.cardPreview, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {preview}
          {script.content.length > 90 ? "…" : ""}
        </Text>
      )}
      <View
        style={[styles.cardPlayRow, { borderTopColor: colors.border }]}
      >
        <Feather name="play-circle" size={14} color={colors.primary} />
        <Text style={[styles.cardPlayText, { color: colors.primary }]}>
          Tap to start teleprompter
        </Text>
      </View>
    </Pressable>
  );
}

function EmptyState() {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <Feather name="file-text" size={52} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        No scripts yet
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        Tap + to write your first script
      </Text>
    </View>
  );
}

const TABLET_MAX_W = 720;

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { scripts, loading } = useScripts();
  const [pressed, setPressed] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const isTablet = width >= 768;
  const centered = isTablet
    ? ({ maxWidth: TABLET_MAX_W, alignSelf: "center" as const, width: "100%" as const })
    : {};

  function handleNew() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/edit");
  }

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: topInset + 8,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={centered}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Scripts
          </Text>
          <View
            style={[styles.headerAccent, { backgroundColor: colors.primary }]}
          />
        </View>
      </View>

      {loading ? null : (
        <FlatList
          data={scripts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ScriptCard script={item} />}
          contentContainerStyle={[
            styles.list,
            centered,
            {
              paddingBottom: bottomInset + 100,
              flexGrow: scripts.length === 0 ? 1 : undefined,
            },
          ]}
          ListEmptyComponent={<EmptyState />}
          showsVerticalScrollIndicator={false}
          scrollEnabled={scripts.length > 0}
        />
      )}

      <TouchableOpacity
        onPress={handleNew}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        activeOpacity={0.85}
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            bottom: bottomInset + 28,
            transform: [{ scale: pressed ? 0.93 : 1 }],
          },
        ]}
      >
        <Feather name="plus" size={26} color={colors.primaryForeground} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  headerAccent: {
    width: 28,
    height: 3,
    borderRadius: 2,
    marginTop: 6,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  cardLeft: {
    flex: 1,
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 3,
  },
  cardMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 2,
  },
  actionBtn: {
    padding: 4,
  },
  cardPreview: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  cardPlayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardPlayText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingBottom: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  fab: {
    position: "absolute",
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
});
