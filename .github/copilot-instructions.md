# Codicent VS Code Extension - AI Coding Instructions

## Project Overview

This is a VS Code extension that provides dual integration with Codicent (codicent.com):
1. **Direct text sending**: Users select text and press `Ctrl+Shift+C` to send to Codicent with workspace context
2. **MCP (Model Context Protocol) integration**: Exposes Codicent's MCP server to VS Code's AI ecosystem
3. **Workspace integration**: Configures projects with `@mention` support for contextual messaging

## Architecture

### Core Components

- **`src/extension.ts`**: Main extension entry point with three responsibilities:
  - Registers `codicent.send` command for enhanced text sending with project context
  - Registers `codicent.configure` command for workspace configuration
  - Registers MCP server definition provider (`codicentMcpProvider`) pointing to `https://mcp.codicent.com`
- **Workspace config**: `.vscode/codicent.json` stores project name for `@mention` integration

### Key Integration Points

The extension uses VS Code's newer MCP integration pattern (VS Code 1.96+):
```typescript
vscode.lm.registerMcpServerDefinitionProvider("codicentMcpProvider", {
  provideMcpServerDefinitions: async () => [
    new vscode.McpHttpServerDefinition(
      "Codicent MCP", 
      vscode.Uri.parse("https://mcp.codicent.com")
    )
  ]
})
```

## Development Workflow

### Build Commands
- `npm run compile` - Compile TypeScript to `out/` directory
- `npm run watch` - Watch mode compilation for development
- `npm run lint` - ESLint validation

### Extension Testing
- Press `F5` in VS Code to launch Extension Development Host
- Test the `Ctrl+Shift+C` command with selected text
- Use `Ctrl+Shift+P` → "Codicent: Configure workspace project" to set up project mentions
- MCP integration requires VS Code Insiders with Copilot enabled

### Key Files Structure
```
src/
├── extension.ts           # Main extension logic (commands + MCP registration)
└── test/                  # Extension tests
.vscode/
├── codicent.json         # Workspace project configuration (created automatically)
├── launch.json           # Debug configuration
└── tasks.json           # Build tasks
```

## Project Conventions

### Message Format with Context
Messages are automatically formatted with workspace context:
```typescript
const contextualText = `@${projectName} From ${fileName}:${lineNumber}\n\n${selectedText}`;
```

### Workspace Configuration Pattern
- Configuration stored in `.vscode/codicent.json` 
- Auto-initialized on first use
- Project name used for `@mention` in messages
- Commands: `codicent.configure` to update project settings

### Error Handling Pattern
The extension uses VS Code's `showErrorMessage` for user-facing errors:
```typescript
if (!editor) {
  vscode.window.showErrorMessage("No editor is active => open one and select some text and try again!");
  return;
}
```

### MCP-First Architecture
- **Primary**: MCP server handles tool integration via Copilot
- **Fallback**: Browser-based compose window for direct user interaction
- **Device Auth**: Will use device auth flow for MCP authentication (implementation pending)

## Configuration Notes

- **Minimum VS Code version**: 1.96.0 (required for MCP API support)
- **Target compilation**: ES2020 with CommonJS modules
- **Package entry point**: `./out/extension.js` (compiled from `src/extension.ts`)
- **Command ID**: `codicent.send` (matches package.json contributions)

## Development Gotchas

1. MCP API is only available in VS Code 1.96+ - older versions will have compilation errors
2. The extension currently has two MCP implementations:
   - HTTP server registration (active) pointing to `mcp.codicent.com`
   - Local stdio server (inactive) in `mcpServer.ts`
3. `activationEvents` are auto-generated from package.json contributions - don't manually specify
4. The `writeConfigFile` function is TODO - currently unused workspace configuration feature


## Publishing the Extension

To publish this extension to the Visual Studio Code Marketplace:

1. **Install vsce (Visual Studio Code Extension Manager):**
   ```cmd
   npm install -g vsce
   ```

2. **Create or use a publisher:**
   - Go to https://marketplace.visualstudio.com/manage to create or manage your publisher.
   - Make sure your account has "Owner" or "Contributor" rights for the publisher.

3. **Create a Personal Access Token (PAT):**
   - Go to https://aka.ms/vscodepat
   - Create a PAT with "Marketplace (read & manage)" and "Packaging (read & manage)" permissions.

4. **Login to vsce:**
   ```cmd
   vsce login <publisher-name>
   ```
   Enter your PAT when prompted.

5. **Package the extension:**
   ```cmd
   vsce package
   ```

6. **Publish the extension:**
   ```cmd
   vsce publish
   ```

For more details, see the [VSCE documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).