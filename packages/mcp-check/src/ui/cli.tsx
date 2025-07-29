#!/usr/bin/env node
import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput } from "ink";
import { spawn } from "child_process";
import { glob } from "glob";
import { readFileSync } from "fs";
import path from "path";

interface Task {
  name: string;
  selected: boolean;
  type: "jest" | "model";
}

interface LogEntry {
  timestamp: string;
  thread: string;
  service: string;
  message: string;
}

interface UIState {
  mode: "task-list" | "task-detail";
  scrollPosition: number;
}

const TERMINAL_HEIGHT = 20;
const LEFT_COLUMN_WIDTH = 30;

const getJestTests = async (): Promise<string[]> => {
  try {
    const testFiles = await glob("**/*.test.ts", { cwd: process.cwd() });
    return testFiles.map((file) => `jest:${path.basename(file, ".test.ts")}`);
  } catch {
    return ["jest:tests"];
  }
};

const getRunningModels = (): string[] => {
  try {
    const testFile = path.join(process.cwd(), "tests/index.test.ts");
    const content = readFileSync(testFile, "utf-8");
    const modelMatch = content.match(/\["([^"]+)"\]/);
    if (modelMatch) {
      return [modelMatch[1]];
    }
  } catch {
    // fallback
  }
  return ["claude-3-haiku-20240307"];
};

const runJestCommand = (
  onLogUpdate: (taskName: string, logs: LogEntry[]) => void,
  onStatusUpdate: (
    taskName: string,
    status: "running" | "completed" | "failed",
  ) => void,
): Promise<void> => {
  return new Promise((resolve) => {
    const jestLogs: LogEntry[] = [];
    const modelLogs: Record<string, LogEntry[]> = {};
    const modelBuffers: Record<string, string> = {};

    const addJestLog = (entry: LogEntry) => {
      jestLogs.push(entry);
      onLogUpdate("jest:index", [...jestLogs]);
    };

    const addModelLog = (modelName: string, entry: LogEntry) => {
      if (!modelLogs[modelName]) {
        modelLogs[modelName] = [];
      }
      modelLogs[modelName].push(entry);
      onLogUpdate(modelName, [...modelLogs[modelName]]);
    };

    const flushModelBuffer = (modelName: string) => {
      if (modelBuffers[modelName]?.trim()) {
        addModelLog(modelName, {
          timestamp: new Date().toISOString(),
          thread: "stream",
          service: modelName,
          message: modelBuffers[modelName].trim(),
        });
        modelBuffers[modelName] = "";
      }
    };

    const child = spawn(
      "npx",
      ["jest", "--colors", "--verbose", "--no-coverage"],
      {
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "1" },
      },
    );

    addJestLog({
      timestamp: new Date().toISOString(),
      thread: "init",
      service: "jest",
      message: "Starting Jest tests...",
    });

    let jestBuffer = "";

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      const lines = chunk.split("\n");
      let cleanJestOutput = "";

      lines.forEach((line: string) => {
        try {
          const streamData = JSON.parse(line.trim());
          if (streamData?.type === "model_stream" && streamData.text) {
            const modelName = streamData.model || "claude-3-haiku-20240307";
            modelBuffers[modelName] =
              (modelBuffers[modelName] || "") + streamData.text;
            const buf = modelBuffers[modelName];
            if (buf.length > 50 || /[.!?\n]/.test(buf)) {
              flushModelBuffer(modelName);
            }
            return;
          }
        } catch {
          // not JSON → jest output
        }

        if (!line.includes('"type":"model_stream"')) {
          cleanJestOutput += line + "\n";
        }
      });

      if (cleanJestOutput.trim()) {
        jestBuffer += cleanJestOutput;
        if (jestBuffer.length > 200 || jestBuffer.includes("\n\n")) {
          addJestLog({
            timestamp: new Date().toISOString(),
            thread: "jest",
            service: "jest",
            message: jestBuffer.trim(),
          });
          jestBuffer = "";
        }
      }
    });

    child.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) {
        addJestLog({
          timestamp: new Date().toISOString(),
          thread: "jest",
          service: "jest",
          message: msg,
        });
      }
    });

    child.on("close", (code) => {
      if (jestBuffer.trim()) {
        addJestLog({
          timestamp: new Date().toISOString(),
          thread: "jest",
          service: "jest",
          message: jestBuffer.trim(),
        });
      }
      Object.keys(modelBuffers).forEach(flushModelBuffer);

      addJestLog({
        timestamp: new Date().toISOString(),
        thread: "complete",
        service: "jest",
        message: `Jest tests completed with exit code: ${code}`,
      });

      const status = code === 0 ? "completed" : "failed";
      onStatusUpdate("jest:index", status);
      Object.keys(modelLogs).forEach((model) =>
        onStatusUpdate(model, "completed"),
      );
      resolve();
    });

    child.on("error", (error) => {
      addJestLog({
        timestamp: new Date().toISOString(),
        thread: "error",
        service: "jest",
        message: `Jest error: ${error.message}`,
      });
      onStatusUpdate("jest:index", "completed");
      resolve();
    });
  });
};

// Función para asegurar que un string tenga exactamente el ancho especificado
const padToWidth = (str: string, width: number): string => {
  // Contar el ancho real considerando emojis (que ocupan 2 espacios)
  const emojiRegex =
    /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  const emojis = str.match(emojiRegex) || [];
  const visualLength = str.length + emojis.length; // emojis cuentan doble

  if (visualLength > width) {
    // Cortar considerando el ancho visual
    let result = "";
    let currentWidth = 0;
    for (const char of str) {
      const charWidth = emojiRegex.test(char) ? 2 : 1;
      if (currentWidth + charWidth > width) break;
      result += char;
      currentWidth += charWidth;
    }
    return result + " ".repeat(width - currentWidth);
  }
  return str + " ".repeat(width - visualLength);
};

const TaskManager = () => {
  const [selectedTask, setSelectedTask] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskLogs, setTaskLogs] = useState<Record<string, LogEntry[]>>({});
  const [taskStatus, setTaskStatus] = useState<
    Record<string, "running" | "completed" | "failed">
  >({});
  const [uiState, setUIState] = useState<UIState>({
    mode: "task-list",
    scrollPosition: 0,
  });

  const handleLogUpdate = (taskName: string, logs: LogEntry[]) => {
    setTaskLogs((prev) => ({ ...prev, [taskName]: logs }));
  };

  const handleStatusUpdate = (
    taskName: string,
    status: "running" | "completed" | "failed",
  ) => {
    setTaskStatus((prev) => ({ ...prev, [taskName]: status }));
  };

  useEffect(() => {
    const loadAndExecute = async () => {
      const jestTests = await getJestTests();
      const models = getRunningModels();

      const allTasks: Task[] = [
        ...jestTests.map((name) => ({
          name,
          selected: false,
          type: "jest" as const,
        })),
        ...models.map((name) => ({
          name,
          selected: false,
          type: "model" as const,
        })),
      ];
      if (allTasks.length) {
        allTasks[0].selected = true;
      }
      setTasks(allTasks);
      setTaskStatus(
        allTasks.reduce((acc, t) => ({ ...acc, [t.name]: "running" }), {}),
      );
      runJestCommand(handleLogUpdate, handleStatusUpdate);
    };
    loadAndExecute();
  }, []);

  useInput((input, key) => {
    if (uiState.mode === "task-list") {
      if (key.upArrow && selectedTask > 0) {
        setSelectedTask((i) => i - 1);
      } else if (key.downArrow && selectedTask < tasks.length - 1) {
        setSelectedTask((i) => i + 1);
      } else if (key.return) {
        setUIState({ mode: "task-detail", scrollPosition: 0 });
      }
    } else {
      const logs = taskLogs[tasks[selectedTask]?.name] || [];
      if (key.upArrow && uiState.scrollPosition > 0) {
        setUIState((s) => ({ ...s, scrollPosition: s.scrollPosition - 1 }));
      } else if (key.downArrow && uiState.scrollPosition < logs.length - 10) {
        setUIState((s) => ({ ...s, scrollPosition: s.scrollPosition + 1 }));
      } else if (key.escape || input === "q") {
        setUIState({ mode: "task-list", scrollPosition: 0 });
      }
    }
    if (input === "q") process.exit(0);
  });

  if (uiState.mode === "task-detail") {
    const task = tasks[selectedTask];
    const logs = taskLogs[task.name] || [];
    const status = taskStatus[task.name] || "running";

    return (
      <Box flexDirection="column" height={TERMINAL_HEIGHT}>
        <Box>
          <Text bold color="white">
            {task.name} -{" "}
            {status === "running"
              ? "Running..."
              : status === "failed"
                ? "Failed"
                : "Completed"}
          </Text>
        </Box>
        <Box>
          <Text color="gray">
            Showing {Math.min(10, logs.length - uiState.scrollPosition)} of{" "}
            {logs.length} logs | ESC to go back
          </Text>
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          {status === "running" && logs.length === 0 && (
            <Box marginTop={1}>
              <Text color="yellow">Running...</Text>
            </Box>
          )}
          {logs
            .slice(uiState.scrollPosition, uiState.scrollPosition + 10)
            .map((entry, i) => (
              <Box key={i + uiState.scrollPosition} marginTop={1}>
                <Text bold color="yellow">
                  {entry.service}
                </Text>
                <Text color="white">
                  {" "}
                  | {entry.timestamp.split("T")[1]?.split(".")[0]}{" "}
                  {entry.thread}
                </Text>
                <Text color="gray">{entry.message}</Text>
              </Box>
            ))}
        </Box>

        <Box>
          <Text color="gray">↑ ↓ - Scroll | ESC - Back | q - Quit</Text>
        </Box>
      </Box>
    );
  }

  // Construir las líneas del lado derecho
  const rightLines: string[] = [];

  // Header
  rightLines.push(
    `${tasks[selectedTask]?.name || "No task"} - ${taskStatus[tasks[selectedTask]?.name] || "Loading..."}`,
  );

  // Info de logs
  rightLines.push(
    `Logs: ${taskLogs[tasks[selectedTask]?.name]?.length || 0} entries | Press Enter to view details`,
  );

  // Línea vacía
  rightLines.push("");

  // Recent logs
  if (tasks[selectedTask] && taskLogs[tasks[selectedTask].name]?.length > 0) {
    rightLines.push("Recent logs:");
    rightLines.push("");

    const recentLogs = taskLogs[tasks[selectedTask].name].slice(-5);
    recentLogs.forEach((entry) => {
      const time = entry.timestamp.split("T")[1]?.split(".")[0];
      rightLines.push(`${entry.service} | ${time}`);
      const truncatedMsg =
        entry.message.substring(0, 80) +
        (entry.message.length > 80 ? "..." : "");
      rightLines.push(truncatedMsg);
      rightLines.push("");
    });
  }

  // Running indicator
  if (
    tasks[selectedTask] &&
    taskStatus[tasks[selectedTask].name] === "running"
  ) {
    rightLines.push(`Running ${tasks[selectedTask].name}...`);
    rightLines.push("");
  }

  // Asegurar que tengamos al menos TERMINAL_HEIGHT - 2 líneas (dejando espacio para los controles)
  while (rightLines.length < TERMINAL_HEIGHT - 2) {
    rightLines.push("");
  }

  // Agregar controles al final
  rightLines.push("↑ ↓ - Select | Enter - Details | q - Quit");
  rightLines.push("Auto-running tests and models");

  // Renderizar línea por línea
  return (
    <Box flexDirection="column" height={TERMINAL_HEIGHT}>
      {/* Header */}
      <Box>
        <Text bold color="white">
          {padToWidth("Tasks", LEFT_COLUMN_WIDTH)}
        </Text>
        <Text color="gray">│ </Text>
        <Text color="gray">{rightLines[0]}</Text>
      </Box>

      {/* Líneas de contenido */}
      {Array.from({ length: TERMINAL_HEIGHT - 1 }).map((_, lineIndex) => {
        // Contenido de la columna izquierda
        let leftContent = "";
        let leftColor = "gray";
        let leftBg = undefined;

        if (lineIndex < tasks.length) {
          const task = tasks[lineIndex];
          const status = taskStatus[task.name] || "running";
          const icon =
            status === "running" ? "⏳" : status === "failed" ? "❌" : "✅";
          const isSelected = lineIndex === selectedTask;
          leftContent = `${icon} ${task.name}`;
          if (isSelected) {
            leftContent = padToWidth(leftContent, LEFT_COLUMN_WIDTH - 2) + " »";
            leftColor = "yellow";
            leftBg = "gray";
          } else {
            leftContent = padToWidth(leftContent, LEFT_COLUMN_WIDTH);
          }
        } else {
          leftContent = padToWidth("", LEFT_COLUMN_WIDTH);
        }

        // Contenido de la columna derecha
        const rightContent = rightLines[lineIndex + 1] || "";

        return (
          <Box key={`line-${lineIndex}`}>
            <Text color={leftColor} backgroundColor={leftBg}>
              {leftContent}
            </Text>
            <Text color="gray">│ </Text>
            <Text
              color={
                lineIndex + 1 === 3 && rightContent === "Recent logs:"
                  ? "white"
                  : rightContent.includes(" | ")
                    ? "yellow"
                    : lineIndex + 1 >= TERMINAL_HEIGHT - 2
                      ? "gray"
                      : "gray"
              }
            >
              {rightContent}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

render(<TaskManager />);
