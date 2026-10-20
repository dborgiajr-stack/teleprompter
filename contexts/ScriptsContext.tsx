import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface Script {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

interface ScriptsContextValue {
  scripts: Script[];
  loading: boolean;
  createScript: (title: string, content: string) => Promise<Script>;
  updateScript: (id: string, title: string, content: string) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  getScript: (id: string) => Script | undefined;
}

const ScriptsContext = createContext<ScriptsContextValue | null>(null);

const STORAGE_KEY = "@teleprompter/scripts";

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function ScriptsProvider({ children }: { children: React.ReactNode }) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          setScripts(JSON.parse(raw));
        }
      } catch {
        // ignore load errors
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (updated: Script[]) => {
    setScripts(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const createScript = useCallback(
    async (title: string, content: string): Promise<Script> => {
      const script: Script = {
        id: generateId(),
        title: title.trim() || "Untitled Script",
        content,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await persist([script, ...scripts]);
      return script;
    },
    [scripts, persist]
  );

  const updateScript = useCallback(
    async (id: string, title: string, content: string) => {
      const updated = scripts.map((s) =>
        s.id === id
          ? {
              ...s,
              title: title.trim() || "Untitled Script",
              content,
              updatedAt: Date.now(),
            }
          : s
      );
      await persist(updated);
    },
    [scripts, persist]
  );

  const deleteScript = useCallback(
    async (id: string) => {
      await persist(scripts.filter((s) => s.id !== id));
    },
    [scripts, persist]
  );

  const getScript = useCallback(
    (id: string) => scripts.find((s) => s.id === id),
    [scripts]
  );

  return (
    <ScriptsContext.Provider
      value={{
        scripts,
        loading,
        createScript,
        updateScript,
        deleteScript,
        getScript,
      }}
    >
      {children}
    </ScriptsContext.Provider>
  );
}

export function useScripts(): ScriptsContextValue {
  const ctx = useContext(ScriptsContext);
  if (!ctx) throw new Error("useScripts must be used within ScriptsProvider");
  return ctx;
}
