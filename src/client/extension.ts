import { workspace, window, commands, Uri, EventEmitter, ExtensionContext, TextDocumentContentProvider, ViewColumn } from "vscode";
import * as preview from "./preview";
import * as language from "./language";

export function activate(context: ExtensionContext) {
    preview.activate(context);
    language.activate(context);
}
