// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { TextEncoder } from "util";
import * as vscode from "vscode";

// TODO: use this to save the codicent extension config file
const writeConfigFile = async (folderPath: vscode.Uri) => {
  const outputPath = vscode.Uri.joinPath(folderPath, ".vscode", "codicent");
  const settings = { project: "" };
  const json = JSON.stringify(settings, null, 2);

  console.log(`Writing .codicent to '${outputPath}'`);
  await vscode.workspace.fs.writeFile(
    outputPath,
    new TextEncoder().encode(json)
  );
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "codicent" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand("codicent.send", () => {
    // The code you place here will be executed every time your command is executed
    // Display a message box to the user
    //vscode.window.showInformationMessage('Hello World from codicent!');

    // TODO: move this to a new command (createCodicentConfigFile)
    //  if (vscode.workspace.workspaceFolders) {
    //    const path = vscode.workspace.workspaceFolders[0].uri;
    //    writeConfigFile(path);
    //  }

    var editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(
        "No editor is active => open one and select some text and try again!"
      );
      return; // No open text editor
    }

    var selection = editor.selection;
    var text = editor.document.getText(selection);

    if (text.trim().length === 0) {
      vscode.window.showErrorMessage(
        "No text selected => select some text and try again!"
      );
      return; // No text selected
    }

    //  vscode.window.showInformationMessage(text);
    vscode.env.openExternal(
      vscode.Uri.parse(`https://codicent.com/compose?text=${encodeURI(text)}`)
    );
  });

  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
