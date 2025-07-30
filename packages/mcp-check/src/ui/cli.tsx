import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, useInput } from "ink";
import { spawn } from "child_process";
import { glob } from "glob";
import path from "path";
import stringWidth from "string-width";

interface Task {
  id: string;
  name: string;
  type: "jest" | "model";
  status: "running" | "completed" | "failed";
  logs: LogEntry[];
  orderIndex: number; // Fixed order position
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

// Simplified log batching
class SimpleLogBatcher {
  private updateTimer: NodeJS.Timeout | null = null;
  private onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  scheduleUpdate() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.onUpdate();
    }, 50);
  }

  destroy() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
  }
}

const runJestCommand = (
  jestTasks: string[],
  onTaskUpdate: (updatedTasks: Task[]) => void,
  initialTasks: Task[],
): Promise<void> => {
  return new Promise((resolve) => {
    const tasks = new Map<string, Task>();
    let nextOrderIndex = 0;

    // Initialize with jest tasks
    initialTasks.forEach((task) => {
      tasks.set(task.name, { ...task, orderIndex: nextOrderIndex++ });
    });

    const logBatcher = new SimpleLogBatcher(() => {
      const sortedTasks = Array.from(tasks.values()).sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      onTaskUpdate([...sortedTasks]);
    });

    const modelBuffers: Record<string, string> = {};
    const modelFlushTimers: Record<string, NodeJS.Timeout> = {};

    const addLogToTask = (taskName: string, entry: LogEntry) => {
      const task = tasks.get(taskName);
      if (task) {
        task.logs.push(entry);
        logBatcher.scheduleUpdate();
      }
    };

    const updateTaskStatus = (
      taskName: string,
      status: "running" | "completed" | "failed",
    ) => {
      const task = tasks.get(taskName);
      if (task) {
        task.status = status;
        logBatcher.scheduleUpdate();
      }
    };

    const scheduleModelFlush = (modelName: string) => {
      if (modelFlushTimers[modelName]) {
        clearTimeout(modelFlushTimers[modelName]);
      }
      modelFlushTimers[modelName] = setTimeout(() => {
        flushModelBuffer(modelName);
      }, 200);
    };

    const flushModelBuffer = (modelName: string) => {
      if (modelFlushTimers[modelName]) {
        clearTimeout(modelFlushTimers[modelName]);
        delete modelFlushTimers[modelName];
      }

      if (modelBuffers[modelName]?.trim()) {
        addLogToTask(modelName, {
          timestamp: new Date().toISOString(),
          thread: "",
          service: modelName,
          message: modelBuffers[modelName].trim(),
        });
        modelBuffers[modelName] = "";
      }
    };

    const child = spawn(
      "npx",
      [
        "jest",
        "--colors",
        "--verbose",
        "--no-coverage",
        "--passWithNoTests",
        "--forceExit",
        "--bail=false",
        "--detectOpenHandles",
      ],
      {
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "1" },
      },
    );

    // Add initial log to jest tasks
    jestTasks.forEach((taskName) => {
      addLogToTask(taskName, {
        timestamp: new Date().toISOString(),
        thread: "",
        service: "jest",
        message: "Starting Jest tests...",
      });
    });

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      const lines = chunk.split("\n");
      let cleanJestOutput = "";

      lines.forEach((line: string) => {
        try {
          const streamData = JSON.parse(line.trim());
          if (streamData?.type === "model_stream" && streamData.text) {
            const modelName = streamData?.model ?? "";
            if (modelName && !tasks.has(modelName)) {
              // Add new model task
              tasks.set(modelName, {
                id: `model-${modelName}`,
                name: modelName,
                type: "model",
                status: "running",
                logs: [],
                orderIndex: nextOrderIndex++,
              });
            }

            if (modelName) {
              modelBuffers[modelName] =
                (modelBuffers[modelName] || "") + streamData.text;
              scheduleModelFlush(modelName);
            }
            return;
          }
        } catch {}

        if (!line.includes('"type":"model_stream"')) {
          cleanJestOutput += line + "\n";
        }
      });

      if (cleanJestOutput.trim()) {
        const outputLines = cleanJestOutput
          .split("\n")
          .filter((line) => line.trim());
        outputLines.forEach((line) => {
          jestTasks.forEach((taskName) => {
            addLogToTask(taskName, {
              timestamp: new Date().toISOString(),
              thread: "",
              service: "jest",
              message: line.trim(),
            });
          });
        });
      }
    });

    child.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) {
        jestTasks.forEach((taskName) => {
          addLogToTask(taskName, {
            timestamp: new Date().toISOString(),
            thread: "",
            service: "jest",
            message: msg,
          });
        });
      }
    });

    child.on("close", (code) => {
      // Clean up timers
      Object.keys(modelFlushTimers).forEach((modelName) => {
        clearTimeout(modelFlushTimers[modelName]);
      });
      Object.keys(modelBuffers).forEach(flushModelBuffer);

      // Final log update
      jestTasks.forEach((taskName) => {
        addLogToTask(taskName, {
          timestamp: new Date().toISOString(),
          thread: "",
          service: "jest",
          message: `Jest tests completed with exit code: ${code}`,
        });
      });

      // Update all task statuses
      const status = code === 0 ? "completed" : "failed";
      tasks.forEach((task) => {
        if (task.type === "jest") {
          updateTaskStatus(task.name, status);
        } else {
          updateTaskStatus(task.name, "completed");
        }
      });

      logBatcher.destroy();
      resolve();
    });

    child.on("error", (error) => {
      logBatcher.destroy();
      jestTasks.forEach((taskName) => {
        addLogToTask(taskName, {
          timestamp: new Date().toISOString(),
          thread: "",
          service: "jest",
          message: `Jest error: ${error.message}`,
        });
        updateTaskStatus(taskName, "completed");
      });
      resolve();
    });
  });
};

const padToWidth = (str: string, width: number): string => {
  const currentWidth = stringWidth(str);
  if (currentWidth >= width) {
    let result = "";
    for (const char of str) {
      if (stringWidth(result + char) > width) break;
      result += char;
    }
    return result + " ".repeat(Math.max(0, width - stringWidth(result)));
  }
  return str + " ".repeat(width - currentWidth);
};

const getStatusIndicator = (
  status: "running" | "completed" | "failed",
  frame: number,
): string => {
  if (status === "running") {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    return frames[frame % frames.length];
  }
  if (status === "failed") return "✗";
  return "✓";
};

const TaskManager = () => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [uiState, setUIState] = useState<UIState>({
    mode: "task-list",
    scrollPosition: 0,
  });
  const [animationFrame, setAnimationFrame] = useState(0);
  const isInitialized = useRef(false);

  // Animation timer
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimationFrame((f) => f + 1);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  // Initialize tasks
  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    const loadAndExecute = async () => {
      try {
        const jestTests = await getJestTests();

        const initialTasks: Task[] = jestTests.map((name, index) => ({
          id: `jest-${name}`,
          name,
          type: "jest" as const,
          status: "running" as const,
          logs: [],
          orderIndex: index,
        }));

        setTasks(initialTasks);

        await runJestCommand(
          jestTests,
          (updatedTasks) => {
            setTasks(updatedTasks);
          },
          initialTasks,
        );
      } catch (error) {
        console.error("Failed to initialize:", error);
        process.exit(1);
      }
    };

    loadAndExecute();
  }, []);

  // Ensure valid selection
  useEffect(() => {
    if (tasks.length > 0 && selectedIndex >= tasks.length) {
      setSelectedIndex(Math.max(0, tasks.length - 1));
    }
  }, [tasks.length, selectedIndex]);

  const currentTask = tasks[selectedIndex] || null;

  useInput((input, key) => {
    if (uiState.mode === "task-list") {
      if (key.upArrow && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (key.downArrow && selectedIndex < tasks.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (key.return && currentTask) {
        setUIState({ mode: "task-detail", scrollPosition: 0 });
      }
    } else {
      const logs = currentTask?.logs || [];
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

  // Detail view
  if (uiState.mode === "task-detail" && currentTask) {
    const logs = currentTask.logs;
    const status = currentTask.status;

    return (
      <Box flexDirection="column" height={TERMINAL_HEIGHT}>
        <Box>
          <Text bold color="white">
            {currentTask.name} -{" "}
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
              <Text color="yellow">
                {getStatusIndicator(status, animationFrame)} Running...
              </Text>
            </Box>
          )}
          {logs
            .slice(uiState.scrollPosition, uiState.scrollPosition + 10)
            .map((entry, i) => (
              <Box key={`log-${i + uiState.scrollPosition}`} marginTop={1}>
                <Text bold color="yellow">
                  {entry.service}
                </Text>
                <Text color="white">
                  {" "}
                  | {entry.timestamp.split("T")[1]?.split(".")[0]}
                </Text>
                <Text color="gray"> {entry.message}</Text>
              </Box>
            ))}
        </Box>

        <Box>
          <Text color="gray">↑ ↓ - Scroll | ESC - Back | q - Quit</Text>
        </Box>
      </Box>
    );
  }

  // Build right panel content
  const rightLines: string[] = [];
  rightLines.push(
    `${currentTask?.name || "No task"} - ${currentTask?.status || "Loading..."}`,
  );
  rightLines.push(
    `Logs: ${currentTask?.logs.length || 0} entries | Press Enter to view details`,
  );
  rightLines.push("");

  if (currentTask && currentTask.logs.length > 0) {
    rightLines.push("Recent logs:");
    rightLines.push("");

    const recentLogs = currentTask.logs.slice(-5);
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

  if (currentTask && currentTask.status === "running") {
    rightLines.push(`Running ${currentTask.name}...`);
    rightLines.push("");
  }

  while (rightLines.length < TERMINAL_HEIGHT - 2) {
    rightLines.push("");
  }

  rightLines.push("↑ ↓ - Select | Enter - Details | q - Quit");
  rightLines.push("Auto-running tests and models");

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

      {/* Body - Fixed number of rows */}
      {Array.from({ length: TERMINAL_HEIGHT - 1 }).map((_, lineIndex) => {
        const task = lineIndex < tasks.length ? tasks[lineIndex] : null;
        const isSelected = lineIndex === selectedIndex && task !== null;

        let leftContent = "";
        let leftColor = "white";
        let leftBg = undefined;

        if (task) {
          const indicator = getStatusIndicator(task.status, animationFrame);
          const statusColor =
            task.status === "running"
              ? "yellow"
              : task.status === "failed"
                ? "red"
                : "green";

          if (isSelected) {
            leftContent = `${indicator} ${padToWidth(task.name, LEFT_COLUMN_WIDTH - 4)} »`;
            leftColor = "yellow";
            leftBg = "gray";
          } else {
            leftContent = `${indicator} ${padToWidth(task.name, LEFT_COLUMN_WIDTH - 2)}`;
            leftColor = statusColor;
          }
        } else {
          leftContent = padToWidth("", LEFT_COLUMN_WIDTH);
        }

        const rightContent = rightLines[lineIndex + 1] || "";

        return (
          <Box key={`row-${lineIndex}`}>
            <Box width={LEFT_COLUMN_WIDTH}>
              <Text color={leftColor} backgroundColor={leftBg}>
                {leftContent}
              </Text>
            </Box>
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
