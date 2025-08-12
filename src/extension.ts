// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { basename } from "path";
import { TextEncoder } from "util";
import * as vscode from "vscode";

// TODO: use this to save the codicent extension config file
const writeConfigFile = async (folderPath: vscode.Uri, config: { project: string }) => {
  const outputPath = vscode.Uri.joinPath(folderPath, ".vscode", "codicent.json");
  const json = JSON.stringify(config, null, 2);

  console.log(`Writing codicent config to '${outputPath}'`);
  await vscode.workspace.fs.writeFile(outputPath, new TextEncoder().encode(json));
  vscode.window.showInformationMessage(`✅ Codicent workspace configured for project: ${config.project}`);
};

// Function to get or create workspace configuration
const getWorkspaceConfig = async (folderPath: vscode.Uri): Promise<{ project: string } | null> => {
  const configPath = vscode.Uri.joinPath(folderPath, ".vscode", "codicent.json");

  try {
    const configData = await vscode.workspace.fs.readFile(configPath);
    const config = JSON.parse(configData.toString());
    return config;
  } catch {
    return null; // Config doesn't exist
  }
};

// Function to post message using MCP via language model
const postToCodicentViaMCP = async (content: string): Promise<boolean> => {
  try {
    // Get available language models
    const models = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: "gpt-4o",
    });

    if (models.length === 0) {
      console.log("No suitable language models available for MCP tool invocation");
      return false;
    }

    const model = models[0];

    // Create messages that request the tool to be called
    const messages = [
      vscode.LanguageModelChatMessage.User(
        `Please use the mcp_codicent_mcp_PostMessage tool to post this message: "${content}"`
      ),
    ];

    // Make request with tool available
    const request = await model.sendRequest(messages, {
      tools: [
        {
          name: "mcp_codicent_mcp_PostMessage",
          description: "Post a message to Codicent via MCP",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "The message content to post to Codicent",
              },
              apiKey: {
                type: "string",
                description: "Optional API key for authentication",
              },
            },
            required: ["message"],
          },
        },
      ],
    });

    // Process the response
    let toolCalled = false;
    for await (const fragment of request.stream) {
      if (fragment instanceof vscode.LanguageModelToolCallPart) {
        console.log("MCP tool called:", fragment.name, fragment.input);
        toolCalled = true;

        // The tool has been called by the language model
        // Show success message
        const preview = content.length > 50 ? content.substring(0, 50) + "..." : content;
        vscode.window.showInformationMessage(`✅ Message sent to Codicent via MCP: "${preview}"`);
        return true;
      }
    }

    if (!toolCalled) {
      console.log("Language model did not call the MCP tool");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to post via MCP:", error);
    vscode.window.showErrorMessage(`Failed to post via MCP: ${error}`);
    return false;
  }
};

// Function to get authentication token (placeholder for device auth flow)
const getCodicentToken = async (): Promise<string | null> => {
  // TODO: Implement device auth flow here
  // For now, return null to trigger fallback
  return null;
};
const showCodicentResponse = (content: string, title: string = "Codicent Response") => {
  const panel = vscode.window.createWebviewPanel("codicentResponse", title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            body { 
                font-family: var(--vscode-font-family); 
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px; 
                line-height: 1.6;
            }
            .response { 
                background: var(--vscode-editor-background); 
                padding: 20px; 
                border-radius: 8px; 
                border: 1px solid var(--vscode-panel-border);
                margin: 10px 0;
            }
            .header {
                color: var(--vscode-textLink-foreground);
                border-bottom: 1px solid var(--vscode-panel-border);
                padding-bottom: 10px;
                margin-bottom: 15px;
            }
            pre {
                background: var(--vscode-textCodeBlock-background);
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
            }
            code {
                background: var(--vscode-textCodeBlock-background);
                padding: 2px 4px;
                border-radius: 3px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h2>${title}</h2>
        </div>
        <div class="response">
            ${content.replace(/\n/g, "<br>")}
        </div>
    </body>
    </html>
  `;
};

// Function to initialize workspace for Codicent
const initializeWorkspace = async () => {
  if (!vscode.workspace.workspaceFolders) return;

  const workspaceFolder = vscode.workspace.workspaceFolders[0];
  const existingConfig = await getWorkspaceConfig(workspaceFolder.uri);

  if (!existingConfig) {
    // Don't auto-prompt on activation, just log that it's not configured
    console.log(
      `Codicent: Workspace '${workspaceFolder.name}' is not configured. Use 'Codicent: Configure workspace project' to set it up.`
    );
  } else {
    console.log(`Codicent: Workspace configured for project: ${existingConfig.project}`);
    return existingConfig.project;
  }

  return null;
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "codicent" is now active!');

  // Register MCP Server Definition Provider
  const mcpProvider = vscode.lm.registerMcpServerDefinitionProvider("codicentMcpProvider", {
    provideMcpServerDefinitions: async () => [
      new vscode.McpHttpServerDefinition(
        "Codicent MCP",
        vscode.Uri.parse("https://mcp.codicent.com"),
        {}, // headers
        "1.0.0" // version
      ),
    ],
    resolveMcpServerDefinition: async (server) => {
      // Here you could add authentication headers or other runtime configuration
      // For now, just return the server as-is
      console.log("Resolving Codicent MCP server connection...");
      return server;
    },
  });

  context.subscriptions.push(mcpProvider);

  // Initialize workspace on activation
  initializeWorkspace();

  // Command to configure workspace
  const configureWorkspaceDisposable = vscode.commands.registerCommand("codicent.configure", async () => {
    if (!vscode.workspace.workspaceFolders) {
      const action = await vscode.window.showWarningMessage(
        "No workspace folder is open. You need to open a folder first to configure Codicent project settings.",
        "Open Folder"
      );

      if (action === "Open Folder") {
        vscode.commands.executeCommand("vscode.openFolder");
      }
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const existingConfig = await getWorkspaceConfig(workspaceFolder.uri);
    const currentProject = existingConfig?.project || workspaceFolder.name;

    const projectName = await vscode.window.showInputBox({
      prompt: "Enter Codicent project name (used as @mention in messages)",
      placeHolder: "e.g., myapp, frontend, api-service",
      value: currentProject,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "Project name cannot be empty";
        }
        if (value.includes(" ")) {
          return "Project name should not contain spaces";
        }
        return null;
      },
    });

    if (projectName && projectName.trim()) {
      await writeConfigFile(workspaceFolder.uri, { project: projectName.trim() });
    }
  });

  context.subscriptions.push(configureWorkspaceDisposable);

  // Direct MCP command
  const sendToMcpDisposable = vscode.commands.registerCommand("codicent.sendToMcp", async () => {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No editor is active => open one and select some text and try again!");
      return;
    }

    var selection = editor.selection;
    var text = editor.document.getText(selection);

    if (text.trim().length === 0) {
      vscode.window.showErrorMessage("No text selected => select some text and try again!");
      return;
    }

    // Get workspace configuration for project mention
    let projectMention = "";
    if (vscode.workspace.workspaceFolders) {
      const config = await getWorkspaceConfig(vscode.workspace.workspaceFolders[0].uri);
      if (config?.project) {
        projectMention = `@${config.project} `;
      }
    }

    // Format message with project mention and file context
    const fileName = basename(editor.document.fileName);
    const lineNumber = selection.start.line + 1;
    const contextualText = `${projectMention}From ${fileName}:${lineNumber}\n\n${text}`;

    // Post via MCP and show response
    const success = await postToCodicentViaMCP(contextualText);

    if (success) {
      // Optionally show response in webview
      showCodicentResponse(contextualText, "Message Sent to Codicent");
    }
  });

  context.subscriptions.push(sendToMcpDisposable);

  // Enhanced send command that posts via MCP
  let disposable = vscode.commands.registerCommand("codicent.send", async () => {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No editor is active => open one and select some text and try again!");
      return;
    }

    var selection = editor.selection;
    var text = editor.document.getText(selection);

    if (text.trim().length === 0) {
      vscode.window.showErrorMessage("No text selected => select some text and try again!");
      return;
    }

    // Get workspace configuration for project mention
    let projectMention = "";
    if (vscode.workspace.workspaceFolders) {
      const config = await getWorkspaceConfig(vscode.workspace.workspaceFolders[0].uri);
      if (config?.project) {
        projectMention = `@${config.project} `;
      }
    }

    // Format message with project mention and file context
    const fileName = basename(editor.document.fileName);
    const lineNumber = selection.start.line + 1;
    const contextualText = `${projectMention}From ${fileName}:${lineNumber}\n\n${text}`;

    // Try to post via MCP first
    const success = await postToCodicentViaMCP(contextualText);

    if (!success) {
      // Fallback to browser if MCP fails
      vscode.window.showInformationMessage("MCP not available. Opening Codicent in browser...");
      const url = `https://codicent.com/compose?text=${encodeURIComponent(contextualText)}`;
      vscode.commands.executeCommand("vscode.open", url);
    }
  });

  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
