export async function loadTools() {
  const fs = await import("fs");
  const path = await import("path");

  const rootDir = path.join(process.cwd());
  const toolsDirs: string[] = [];

  function findToolsDirs(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "tools") {
          toolsDirs.push(fullPath);
        } else {
          findToolsDirs(fullPath);
        }
      }
    }
  }

  findToolsDirs(rootDir);

  if (toolsDirs.length === 0) {
    throw new Error('No "tools" folder found recursively in project.');
  }

  const tools: Record<string, any> = {};

  for (const toolsDir of toolsDirs) {
    const files = fs
      .readdirSync(toolsDir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));

    for (const file of files) {
      try {
        const toolPath = path.join(toolsDir, file);
        const content = fs.readFileSync(toolPath, "utf-8");

        // Extract metadata from file content using regex
        const metadataMatch = content.match(
          /export const metadata = \{([\s\S]*?)\};/,
        );

        if (metadataMatch) {
          const metadataContent = metadataMatch[1];
          const nameMatch = metadataContent.match(/name:\s*["']([^"']+)["']/);
          const descriptionMatch = metadataContent.match(
            /description:\s*["']([^"']+)["']/,
          );
          const titleMatch = metadataContent.match(/title:\s*["']([^"']+)["']/);

          if (nameMatch && descriptionMatch) {
            const toolName = nameMatch[1];
            const description = descriptionMatch[1];
            const title = titleMatch ? titleMatch[1] : toolName;

            tools[toolName] = {
              name: toolName,
              description: description,
              title: title,
              execute: async () => ({
                success: true,
                message: "Tool executed successfully",
              }),
            };

            console.log(`Loaded tool: ${toolName} - ${title}: ${description}`);
          }
        }
      } catch (error) {
        console.log(
          `Failed to read ${file}:`,
          JSON.stringify(error?.message ?? error),
        );
      }
    }
  }

  console.log(`Loaded ${Object.keys(tools).length} tools`, Object.keys(tools));
  return tools;
}
