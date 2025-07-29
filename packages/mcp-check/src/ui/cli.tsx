import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput } from "ink";
import { spawn } from "child_process";
import { glob } from "glob";
import path from "path";
import stringWidth from "string-width";

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

const runJestCommand = (
  jestTasks: string[],
  onLogUpdate: (taskName: string, logs: LogEntry[]) => void,
  onStatusUpdate: (
    taskName: string,
    status: "running" | "completed" | "failed",
  ) => void,
  onModelDiscovered: (modelName: string) => void,
): Promise<void> => {
  return new Promise((resolve) => {
    const jestLogs: LogEntry[] = [];
    const modelLogs: Record<string, LogEntry[]> = {};
    const modelBuffers: Record<string, string> = {};

    const addJestLog = (entry: LogEntry) => {
      jestLogs.push(entry);
      jestTasks.forEach((taskName) => {
        onLogUpdate(taskName, [...jestLogs]);
      });
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

    addJestLog({
      timestamp: new Date().toISOString(),
      thread: "",
      service: "jest",
      message: "Starting Jest tests...",
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
            if (modelName && !modelLogs[modelName]) {
              onModelDiscovered(modelName);
            }
            modelBuffers[modelName] =
              (modelBuffers[modelName] || "") + streamData.text;
            const buf = modelBuffers[modelName];
            if (buf.length > 50 || /[.!?\n]/.test(buf)) {
              flushModelBuffer(modelName);
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
          addJestLog({
            timestamp: new Date().toISOString(),
            thread: "",
            service: "jest",
            message: line.trim(),
          });
        });
      }
    });

    child.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) {
        addJestLog({
          timestamp: new Date().toISOString(),
          thread: "",
          service: "jest",
          message: msg,
        });
      }
    });

    child.on("close", (code) => {
      Object.keys(modelBuffers).forEach(flushModelBuffer);

      addJestLog({
        timestamp: new Date().toISOString(),
        thread: "",
        service: "jest",
        message: `Jest tests completed with exit code: ${code}`,
      });

      const status = code === 0 ? "completed" : "failed";
      jestTasks.forEach((taskName) => {
        onStatusUpdate(taskName, status);
      });
      Object.keys(modelLogs).forEach((model) =>
        onStatusUpdate(model, "completed"),
      );
      resolve();
    });

    child.on("error", (error) => {
      addJestLog({
        timestamp: new Date().toISOString(),
        thread: "",
        service: "jest",
        message: `Jest error: ${error.message}`,
      });
      jestTasks.forEach((taskName) => {
        onStatusUpdate(taskName, "completed");
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

// Get status indicator characters
const getStatusIndicator = (
  status: "running" | "completed" | "failed",
  frame: number,
): string => {
  if (status === "running") {
    // Simple rotating animation
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    return frames[frame % frames.length];
  }
  if (status === "failed") {
    return "✗";
  }
  return "✓";
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
  const [animationFrame, setAnimationFrame] = useState(0);

  // Animation for spinners
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimationFrame((f) => f + 1);
    }, 80);
    return () => clearInterval(timer);
  }, []);

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
      try {
        const jestTests = await getJestTests();
        const models: string[] = [];

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
        const handleModelDiscovered = (modelName: string) => {
          setTasks((prevTasks) => {
            if (prevTasks.some((t) => t.name === modelName)) return prevTasks;
            const newTask = {
              name: modelName,
              selected: false,
              type: "model" as const,
            };
            return [...prevTasks, newTask];
          });
          setTaskStatus((prevStatus) => ({
            ...prevStatus,
            [modelName]: "running",
          }));
        };

        runJestCommand(
          jestTests,
          handleLogUpdate,
          handleStatusUpdate,
          handleModelDiscovered,
        );
      } catch (error) {
        console.error("Failed to initialize:", error);
        process.exit(1);
      }
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
              <Text color="yellow">
                {getStatusIndicator(status, animationFrame)} Running...
              </Text>
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

  // Build right column lines
  const rightLines: string[] = [];

  // Header
  rightLines.push(
    `${tasks[selectedTask]?.name || "No task"} - ${taskStatus[tasks[selectedTask]?.name] || "Loading..."}`,
  );

  // Log info
  rightLines.push(
    `Logs: ${taskLogs[tasks[selectedTask]?.name]?.length || 0} entries | Press Enter to view details`,
  );

  // Empty line
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

  // Ensure we have at least TERMINAL_HEIGHT - 2 lines
  while (rightLines.length < TERMINAL_HEIGHT - 2) {
    rightLines.push("");
  }

  // Add controls at the end
  rightLines.push("↑ ↓ - Select | Enter - Details | q - Quit");
  rightLines.push("Auto-running tests and models");

  // Render line by line
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

      {/* Content lines */}
      {Array.from({ length: TERMINAL_HEIGHT - 1 }).map((_, lineIndex) => {
        // Left column content
        let leftContent = "";
        let leftColor = "white";
        let leftBg = undefined;

        if (lineIndex < tasks.length) {
          const task = tasks[lineIndex];
          const status = taskStatus[task.name] || "running";
          const isSelected = lineIndex === selectedTask;
          const indicator = getStatusIndicator(status, animationFrame);

          // Build the complete string with indicator
          const fullText = `${indicator} ${task.name}`;

          if (isSelected) {
            leftContent = padToWidth(fullText, LEFT_COLUMN_WIDTH - 2) + " »";
            leftColor = "yellow";
            leftBg = "gray";
          } else {
            leftContent = padToWidth(fullText, LEFT_COLUMN_WIDTH);
          }
        } else {
          leftContent = padToWidth("", LEFT_COLUMN_WIDTH);
        }

        // Get status color for the indicator
        let statusColor = "white";
        if (lineIndex < tasks.length) {
          const status = taskStatus[tasks[lineIndex].name] || "running";
          statusColor =
            status === "running"
              ? "yellow"
              : status === "failed"
                ? "red"
                : "green";
        }

        const rightContent = rightLines[lineIndex + 1] || "";

        return (
          <Box key={`line-${lineIndex}`}>
            {lineIndex < tasks.length && leftContent.length > 0 ? (
              <Box width={LEFT_COLUMN_WIDTH}>
                <Text color={statusColor}>{leftContent.charAt(0)} </Text>
                <Text color={leftColor} backgroundColor={leftBg}>
                  {leftContent.substring(2)}
                </Text>
              </Box>
            ) : (
              <Text color={leftColor} backgroundColor={leftBg}>
                {leftContent}
              </Text>
            )}
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
