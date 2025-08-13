// The module 'vscode' contains the VS Code extensibility API
import { basename } from "path";
import { TextEncoder } from "util";
import * as vscode from "vscode";

// Save codicent extension config file
const writeConfigFile = async (
  folderPath: vscode.Uri,
  config: { project: string; accessToken?: string; refreshToken?: string }
) => {
  const dir = vscode.Uri.joinPath(folderPath, ".vscode");
  await vscode.workspace.fs.createDirectory(dir);
  const outputPath = vscode.Uri.joinPath(dir, "codicent.json");
  const json = JSON.stringify(config, null, 2);
  console.log(`Writing codicent config to '${outputPath}'`);
  await vscode.workspace.fs.writeFile(outputPath, new TextEncoder().encode(json));
  vscode.window.showInformationMessage(`✅ Codicent workspace configured for project: ${config.project}`);
};

// Get or create workspace configuration
const getWorkspaceConfig = async (
  folderPath: vscode.Uri
): Promise<{ project: string; accessToken?: string; refreshToken?: string } | null> => {
  const configPath = vscode.Uri.joinPath(folderPath, ".vscode", "codicent.json");
  try {
    console.log("Codicent: Reading config from:", configPath.fsPath);
    const configData = await vscode.workspace.fs.readFile(configPath);
    const configContent = configData.toString();
    console.log("Codicent: Raw config file content:", configContent);
    if (configContent.trim() === "") {
      console.log("Codicent: Config file is empty, treating as null.");
      return null;
    }
    const config = JSON.parse(configContent) as {
      project: string;
      accessToken?: string;
      refreshToken?: string;
    };
    console.log("Codicent: Parsed config:", { project: config.project, hasToken: !!config.accessToken });
    return config;
  } catch (error) {
    console.error("Codicent: Failed to get/parse workspace config:", error);
    return null;
  }
};

// Simple JWT decoder (no signature validation)
const decodeJWT = (token: string): any | null => {
  try {
    // JWT has 3 parts: header.payload.signature
    const parts = token.split(".");
    if (parts.length !== 3) {
      console.error("JWT: Invalid token format - expected 3 parts");
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    // Add padding if needed for base64 decoding
    const paddedPayload = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decodedPayload = Buffer.from(paddedPayload, "base64").toString("utf8");

    const parsedPayload = JSON.parse(decodedPayload);
    console.log("JWT Payload:", JSON.stringify(parsedPayload, null, 2));

    return parsedPayload;
  } catch (error) {
    console.error("JWT: Failed to decode token:", error);
    return null;
  }
};

// Get project name from JWT token
const getProjectFromToken = (token: string): string | null => {
  const payload = decodeJWT(token);
  if (!payload) return null;

  // Check common JWT claims where project name might be stored
  return payload.project || payload.proj || payload.aud || payload.client_id || null;
};

// Device authorization flow types
interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string | null;
  tokenType: string;
  expiresIn: number;
}

// Start device authorization flow
const startDeviceAuth = async (projectName?: string): Promise<DeviceAuthResponse | null> => {
  return new Promise((resolve) => {
    const https = require("https");

    // Make project parameter optional - if not provided, omit it from the request
    const projectParam = projectName ? `&Project=${encodeURIComponent(projectName)}` : "";
    const postData = `ClientId=cli-app&Scope=api${projectParam}`;

    const options = {
      hostname: "codicent.com",
      port: 443,
      path: "/oauth/device_authorization",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": postData.length,
      },
    };

    const req = https.request(options, (res: any) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        console.log(`Device Auth: HTTP ${res.statusCode}: ${data}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const response = JSON.parse(data);
            console.log("Device Auth: Parsed response:", JSON.stringify(response, null, 2));

            // Map response to expected interface (handle different field names)
            const deviceAuth: DeviceAuthResponse = {
              device_code: response.device_code || response.deviceCode,
              user_code: response.user_code || response.userCode,
              verification_uri: response.verification_uri || response.verificationUri,
              expires_in: response.expires_in || response.expiresIn || 600,
              interval: response.interval || 5,
            };

            console.log("Device Auth: Mapped response:", JSON.stringify(deviceAuth, null, 2));
            resolve(deviceAuth);
          } catch (error) {
            console.error("Device Auth: Failed to parse response:", error);
            resolve(null);
          }
        } else {
          console.error(`Device Auth: Request failed with ${res.statusCode}`);
          resolve(null);
        }
      });
    });

    req.on("error", (error: any) => {
      console.error("Device Auth: Request failed:", error);
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
};

// Poll for device authorization token
const pollForToken = async (deviceCode: string, interval: number): Promise<TokenResponse | null> => {
  return new Promise((resolve) => {
    const https = require("https");

    // Match your server's DeviceTokenRequest class field names exactly
    const postData = `GrantType=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&DeviceCode=${encodeURIComponent(
      deviceCode
    )}&ClientId=cli-app`;

    console.log("Token Poll: Request data:", postData);

    const options = {
      hostname: "codicent.com",
      port: 443,
      path: "/oauth/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": postData.length,
      },
    };

    const req = https.request(options, (res: any) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        console.log(`Token Poll: HTTP ${res.statusCode}: ${data}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const response = JSON.parse(data) as TokenResponse;
            console.log("Token Poll: Success! Got tokens");
            // Add a check to ensure the accessToken exists
            if (!response.accessToken) {
              console.error("Token Poll: Response is successful but missing accessToken.");
              resolve(null);
              return;
            }
            resolve(response);
          } catch (error) {
            console.error("Token Poll: Failed to parse response:", error);
            resolve(null);
          }
        } else if (res.statusCode === 400) {
          try {
            const errorResponse = JSON.parse(data);
            console.log("Token Poll: 400 Error response:", JSON.stringify(errorResponse, null, 2));

            // If we get validation errors about required fields, it's a bug in our request
            if (
              errorResponse.errors &&
              (errorResponse.errors.ClientId || errorResponse.errors.DeviceCode || errorResponse.errors.GrantType)
            ) {
              console.error("Token Poll: Request validation failed - check field names/values");
              resolve(null); // Stop polling - this is a client error
              return;
            }

            // Check for authorization pending in various formats
            if (
              errorResponse.error === "authorization_pending" ||
              errorResponse.error === "slow_down" ||
              (errorResponse.title && errorResponse.title.toLowerCase().includes("pending"))
            ) {
              console.log("Token Poll: Authorization still pending, continue polling");
              resolve(null); // Continue polling
            } else if (errorResponse.error === "invalid_grant") {
              console.error("Token Poll: Invalid grant. The device code is likely expired or used. Stopping poll.");
              resolve(null); // Stop polling
            } else {
              console.error("Token Poll: Authorization failed or other error:", errorResponse);
              resolve(null); // Stop polling - this is likely a permanent error
            }
          } catch (parseError) {
            console.error("Token Poll: Failed to parse error response:", parseError);
            resolve(null);
          }
        } else {
          console.error(`Token Poll: Request failed with ${res.statusCode}: ${data}`);
          resolve(null);
        }
      });
    });

    req.on("error", (error: any) => {
      console.error("Token Poll: Request failed:", error);
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
};

// Complete device authorization flow
const completeDeviceAuth = async (
  projectName?: string
): Promise<{ accessToken: string; refreshToken?: string } | null> => {
  try {
    // Step 1: Start device authorization
    const deviceAuth = await startDeviceAuth(projectName);
    if (!deviceAuth) {
      vscode.window.showErrorMessage("Failed to start device authorization");
      return null;
    }

    // Validate required fields
    if (!deviceAuth.user_code || !deviceAuth.device_code || !deviceAuth.verification_uri) {
      console.error("Device Auth: Missing required fields:", deviceAuth);
      vscode.window.showErrorMessage("Invalid device authorization response. Check console for details.");
      return null;
    }

    // Step 2: Show user code and open verification URL
    const userChoice = await vscode.window.showInformationMessage(
      `Codicent Authorization Required\n\nUser Code: ${deviceAuth.user_code}\n\nClick "Open Browser" to authorize this device.`,
      "Open Browser",
      "Cancel"
    );

    if (userChoice !== "Open Browser") {
      return null;
    }

    // Open verification URL
    vscode.env.openExternal(vscode.Uri.parse(deviceAuth.verification_uri + "?user_code=" + deviceAuth.user_code));

    // Step 3: Poll for token
    const maxAttempts = Math.floor(deviceAuth.expires_in / deviceAuth.interval);
    let attempts = 0;

    return new Promise((resolve) => {
      const pollInterval = setInterval(async () => {
        attempts++;

        if (attempts > maxAttempts) {
          clearInterval(pollInterval);
          vscode.window.showErrorMessage("Device authorization expired. Please try again.");
          resolve(null);
          return;
        }

        const tokenResponse = await pollForToken(deviceAuth.device_code, deviceAuth.interval);
        if (tokenResponse) {
          clearInterval(pollInterval);
          vscode.window.showInformationMessage("✅ Successfully authorized with Codicent!");
          resolve({
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken ?? undefined,
          });
        }
        // If null, continue polling
      }, deviceAuth.interval * 1000);
    });
  } catch (error) {
    console.error("Device authorization failed:", error);
    vscode.window.showErrorMessage(`Device authorization failed: ${error}`);
    return null;
  }
};

// Get token from workspace config only (OAuth device flow)
const getCodicentToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  let token: string | null = null;

  if (vscode.workspace.workspaceFolders) {
    // Get token from workspace config
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    console.log(`Codicent: Reading workspace config from ${workspaceFolder.uri.fsPath}/.vscode/codicent.json`);
    const config = await getWorkspaceConfig(workspaceFolder.uri);

    if (config?.accessToken) {
      console.log("Codicent: Found access token in workspace config");

      // Skip placeholder tokens from workspace config
      if (
        config.accessToken === "your_actual_api_key_here" ||
        config.accessToken === "placeholder" ||
        config.accessToken.includes("placeholder")
      ) {
        console.log("Codicent: Ignoring placeholder token from workspace config");
        token = null;
      } else {
        token = config.accessToken;
        console.log("Codicent: Using stored access token from workspace config");
      }
    } else {
      console.log("Codicent: No access token in workspace config");
    }
  } else {
    console.log("Codicent: No workspace folders available");
  }

  if (token) {
    console.log("Codicent: Valid token found in workspace config");
    // Decode and display JWT contents
    console.log("=== JWT Token Analysis ===");
    const payload = decodeJWT(token);
    if (payload) {
      const projectName = getProjectFromToken(token);
      console.log("Extracted project name from token:", projectName);

      // Log expiration if present
      if (payload.exp) {
        const expDate = new Date(payload.exp * 1000);
        console.log("Token expires at:", expDate.toISOString());
      }
    }
    console.log("=== End JWT Analysis ===");
    return token;
  }

  console.log("Codicent: No token found");
  return null;
};

// Get token or trigger device auth if needed
const ensureCodicentToken = async (): Promise<string | null> => {
  let token = await getCodicentToken();

  if (!token) {
    // No token available, need to authenticate
    vscode.window.showInformationMessage("Codicent: No token found. Please run the 'Codicent: Authenticate' command.");
    // We can't trigger the UI flow from here reliably without more context.
    // It's better to guide the user to run the command.
    return null;
  }

  return token;
};

// Get project mention from current token
const getProjectMention = async (): Promise<string> => {
  console.log("Codicent: Getting project mention from token...");
  const token = await getCodicentToken(true); // Force refresh
  if (!token) {
    console.log("Codicent: No token available for project mention");
    return "";
  }

  const projectName = getProjectFromToken(token);
  console.log("Codicent: Extracted project name for mention:", projectName);
  return projectName ? `@${projectName} ` : "";
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
                word-break: break-word;
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

// Test connection to MCP server status endpoint
const testMcpServerStatus = async (): Promise<boolean> => {
  return new Promise((resolve) => {
    const https = require("https");

    const options = {
      hostname: "mcp.codicent.com",
      port: 443,
      path: "/status",
      method: "GET",
      timeout: 5000,
    };

    const req = https.request(options, (res: any) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        console.log(`Codicent Status: HTTP ${res.statusCode}: ${data}`);
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
    });

    req.on("error", (error: any) => {
      console.error("Codicent Status: Connection failed:", error.message);
      resolve(false);
    });

    req.on("timeout", () => {
      console.error("Codicent Status: Request timeout");
      req.destroy();
      resolve(false);
    });

    req.end();
  });
};

// Post message directly to Codicent MCP server via HTTP
const postToCodicentDirectly = async (content: string): Promise<boolean> => {
  try {
    const token = await ensureCodicentToken();
    if (!token) {
      vscode.window.showErrorMessage("Codicent: No API key found. Please authenticate first.");
      return false;
    }

    console.log("Codicent: Posting message directly to MCP server...");

    // Use Node.js built-in https module
    const https = require("https");

    // Proper MCP protocol request
    const mcpRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "PostMessage",
        arguments: {
          message: content,
          apiKey: token,
        },
      },
    };

    const postData = JSON.stringify(mcpRequest);

    return new Promise((resolve) => {
      const options = {
        hostname: "mcp.codicent.com",
        port: 443,
        path: "/", // MCP endpoint is at root
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          "Content-Length": postData.length,
        },
      };

      const req = https.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          console.log(`Codicent: HTTP ${res.statusCode}: ${res.statusMessage}`);
          console.log("Codicent: Response:", data);

          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              // Parse MCP response, which may be in an SSE (Server-Sent Events) format.
              let jsonString = "";
              const lines = data.trim().split("\n");
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  jsonString = line.substring(5).trim();
                  break; // Found the data line
                }
              }

              // If no 'data:' line was found, the whole response might be JSON (e.g., an error).
              if (!jsonString) {
                jsonString = data;
              }

              const mcpResponse = JSON.parse(jsonString);
              console.log("Codicent: Parsed MCP response:", mcpResponse);

              if (mcpResponse.error) {
                vscode.window.showErrorMessage(`Codicent MCP error: ${mcpResponse.error.message || "Unknown error"}`);
                resolve(false);
                return;
              }

              // Extract result content (should be "Posted message id: {uuid}")
              const resultContent = mcpResponse.result?.content;
              let messageId: string | undefined;
              let resultText = "";

              if (Array.isArray(resultContent)) {
                // MCP result content is an array of content parts
                for (const part of resultContent) {
                  if (part.type === "text" && part.text) {
                    resultText += part.text;
                  }
                }
              } else if (typeof resultContent === "string") {
                resultText = resultContent;
              } else if (mcpResponse.result && typeof mcpResponse.result === "string") {
                resultText = mcpResponse.result;
              }

              console.log("Codicent: Extracted result text:", resultText);

              // Extract message ID from result text
              const match = resultText.match(/[0-9a-f-]{36}/i);
              if (match) messageId = match[0];

              const preview = content.length > 50 ? content.substring(0, 50) + "..." : content;
              const suffix = messageId ? ` (id: ${messageId})` : "";
              vscode.window.showInformationMessage(`✅ Message sent to Codicent: "${preview}"${suffix}`);
              resolve(true);
            } catch (parseError) {
              console.error("Codicent: Failed to parse response:", parseError);
              vscode.window.showErrorMessage(`Failed to parse Codicent response: ${parseError}`);
              resolve(false);
            }
          } else {
            vscode.window.showErrorMessage(`Failed to post to Codicent: ${res.statusCode} ${res.statusMessage}`);
            resolve(false);
          }
        });
      });

      req.on("error", (error: any) => {
        console.error("Codicent: Direct post failed:", error);
        vscode.window.showErrorMessage(`Failed to post to Codicent: ${error.message}`);
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error("Codicent: Direct post failed:", error);
    vscode.window.showErrorMessage(`Failed to post to Codicent: ${error}`);
    return false;
  }
};
// Initialize workspace (log-only if not configured)
const initializeWorkspace = async () => {
  if (!vscode.workspace.workspaceFolders) return null;
  const workspaceFolder = vscode.workspace.workspaceFolders[0];
  const existingConfig = await getWorkspaceConfig(workspaceFolder.uri);
  if (!existingConfig) {
    console.log(
      `Codicent: Workspace '${workspaceFolder.name}' is not configured. Use 'Codicent: Authenticate' to set it up.`
    );
    return null;
  }
  console.log(`Codicent: Workspace configured for project: ${existingConfig.project}`);
  return existingConfig.project;
};

// Activation
export function activate(context: vscode.ExtensionContext) {
  console.log("Codicent extension is now active.");

  // Register MCP Server Definition Provider
  const mcpProvider = vscode.lm.registerMcpServerDefinitionProvider("codicentMcpProvider", {
    provideMcpServerDefinitions: async () => {
      console.log("Codicent: provideMcpServerDefinitions called");
      const definitions = [
        new vscode.McpHttpServerDefinition(
          "Codicent MCP",
          vscode.Uri.parse("https://mcp.codicent.com"),
          {}, // headers set in resolve below
          "1.0.0"
        ),
      ];
      console.log("Codicent: Providing MCP server definitions:", definitions.length);
      return definitions;
    },
    resolveMcpServerDefinition: async (server) => {
      console.log("Codicent: resolveMcpServerDefinition called for:", server.label);
      const token = await getCodicentToken(); // Don't trigger auth flow here, just get existing token
      if (!token) {
        console.log("Codicent: No API key found for MCP server");
        vscode.window.showWarningMessage("Codicent MCP: No API key present. Use 'Codicent: Authenticate' to sign in.");
        return server;
      }

      console.log("Codicent: API key found, adding authorization header");
      // Check if it's an HTTP server definition
      if (server instanceof vscode.McpHttpServerDefinition) {
        return new vscode.McpHttpServerDefinition(
          server.label,
          server.uri,
          { ...(server.headers ?? {}), Authorization: `Bearer ${token}` },
          server.version
        );
      }

      // For other server types, just return as-is
      return server;
    },
  });
  context.subscriptions.push(mcpProvider);
  console.log("Codicent: MCP provider registered");

  // Initialize workspace on activation
  initializeWorkspace();

  // Authentication command
  const authenticateDisposable = vscode.commands.registerCommand("codicent.authenticate", async () => {
    if (!vscode.workspace.workspaceFolders) {
      const action = await vscode.window.showWarningMessage(
        "No workspace folder is open. Open a folder to authenticate with Codicent.",
        "Open Folder"
      );
      if (action === "Open Folder") vscode.commands.executeCommand("vscode.openFolder");
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];

    vscode.window.showInformationMessage("Starting Codicent device authorization...");

    // Start device auth without requiring project name
    const authResult = await completeDeviceAuth();
    if (authResult) {
      // Extract project name from the JWT token
      const projectFromToken = getProjectFromToken(authResult.accessToken);
      
      if (!projectFromToken) {
        vscode.window.showWarningMessage("⚠️ Could not extract project name from token. Using default 'unknown-project'");
      }

      const updatedConfig = {
        project: projectFromToken || "unknown-project", // Use project name from token
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
      };
      await writeConfigFile(workspaceFolder.uri, updatedConfig);
      vscode.window.showInformationMessage(`✅ Successfully authenticated with Codicent! Project: ${updatedConfig.project}`);
    } else {
      vscode.window.showErrorMessage("❌ Codicent authentication failed");
    }
  });
  context.subscriptions.push(authenticateDisposable);

  // Clear tokens command (for troubleshooting placeholder tokens)
  const clearTokensDisposable = vscode.commands.registerCommand("codicent.clearTokens", async () => {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showErrorMessage("No workspace folder is open.");
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const config = await getWorkspaceConfig(workspaceFolder.uri);

    if (config) {
      // Clear tokens but keep project name
      const clearedConfig = {
        project: config.project,
        // Remove accessToken and refreshToken
      };
      await writeConfigFile(workspaceFolder.uri, clearedConfig);
      vscode.window.showInformationMessage("✅ Cleared all tokens. Use 'Codicent: Authenticate' to sign in again.");
    } else {
      vscode.window.showInformationMessage("No config file found to clear.");
    }
  });
  context.subscriptions.push(clearTokensDisposable);

  // Direct MCP command (uses selection)
  const sendToMcpDisposable = vscode.commands.registerCommand("codicent.sendToMcp", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No editor is active => open one and select some text and try again!");
      return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);
    if (text.trim().length === 0) {
      vscode.window.showErrorMessage("No text selected => select some text and try again!");
      return;
    }

    // Get project mention from JWT token
    const projectMention = await getProjectMention();

    // Context
    const fileName = basename(editor.document.fileName);
    const lineNumber = selection.start.line + 1;
    const contextualText = `@${projectMention}\n${text}`;

    const success = await postToCodicentDirectly(contextualText);
    if (success) showCodicentResponse(contextualText, "Message Sent to Codicent");
  });
  context.subscriptions.push(sendToMcpDisposable);

  // Enhanced send command: Direct HTTP first, fallback to browser
  const sendDisposable = vscode.commands.registerCommand("codicent.send", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No editor is active => open one and select some text and try again!");
      return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);
    if (text.trim().length === 0) {
      vscode.window.showErrorMessage("No text selected => select some text and try again!");
      return;
    }

    // Get project mention from JWT token
    const projectMention = await getProjectMention();

    // const fileName = basename(editor.document.fileName);
    // const lineNumber = selection.start.line + 1;
    const contextualText = `${projectMention}\n${text}`;

    const success = await postToCodicentDirectly(contextualText);
    if (!success) {
      vscode.window.showInformationMessage("Direct post failed. Opening Codicent in browser...");
      const url = `https://codicent.com/compose?text=${encodeURIComponent(contextualText)}`;
      vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(url));
    }
  });
  context.subscriptions.push(sendDisposable);

  // Debug command to test MCP connectivity
  const debugMcpDisposable = vscode.commands.registerCommand("codicent.debugMcp", async () => {
    console.log("=== Codicent MCP Debug ===");

    // Check workspace configuration
    if (vscode.workspace.workspaceFolders) {
      const workspaceFolder = vscode.workspace.workspaceFolders[0];
      const config = await getWorkspaceConfig(workspaceFolder.uri);
      console.log("Workspace config:", {
        project: config?.project || "Not configured",
        hasAccessToken: !!config?.accessToken,
        hasRefreshToken: !!config?.refreshToken,
      });
    } else {
      console.log("No workspace folder open");
    }

    // Check token availability
    const token = await getCodicentToken();
    console.log("Token available:", !!token);
    if (token) {
      console.log("Token length:", token.length);
      console.log("Token starts with:", token.substring(0, 8) + "...");
    }

    // Test MCP server availability
    console.log("Testing MCP server status endpoint...");
    const serverAvailable = await testMcpServerStatus();
    console.log("MCP server status result:", serverAvailable);

    // Test direct HTTP connection
    if (token && serverAvailable) {
      console.log("Testing direct HTTP connection to MCP server...");
      const testSuccess = await postToCodicentDirectly("Debug test message from VS Code extension");
      console.log("Direct HTTP test result:", testSuccess);
    } else if (!token) {
      console.log("Cannot test HTTP connection - no API key");
    } else {
      console.log("Cannot test HTTP connection - server not available");
    }

    // Try to get language models (keep for comparison)
    const models = await vscode.lm.selectChatModels({});
    console.log("Available language models:", models.length);
    models.forEach((model, i) => {
      console.log(`  ${i}: ${model.vendor}/${model.family} (${model.name})`);
    });

    vscode.window.showInformationMessage(
      "Debug completed. Check the console (View → Output → select 'Codicent') for details."
    );
  });
  context.subscriptions.push(debugMcpDisposable);
}

export function deactivate() {}
