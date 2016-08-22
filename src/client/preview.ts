import { workspace, window, commands, Uri, EventEmitter, ExtensionContext, TextDocumentContentProvider, ViewColumn } from "vscode";
import { build, Spec } from "ecmarkup";
import * as fs from "fs";

export const previewUri = Uri.parse('ecmarkup-preview://authority/ecmarkup-preview');

export function activate(context: ExtensionContext) {
    const provider = new EcmarkupTextDocumentContentProvider();
    workspace.onDidChangeTextDocument(e => {
        if (e.document === window.activeTextEditor.document) {
            provider.update(previewUri);
        }
    });
    context.subscriptions.push(workspace.registerTextDocumentContentProvider("ecmarkup-preview", provider));
    context.subscriptions.push(commands.registerCommand("extension.showEcmarkupPreview", () => {
        return commands.executeCommand("vscode.previewHtml", previewUri, ViewColumn.Two, "ECMArkup Preview")
            .then(undefined, reason => { window.showErrorMessage(reason); });
    }));
}

class EcmarkupTextDocumentContentProvider implements TextDocumentContentProvider {
    private _onDidChange = new EventEmitter<Uri>();

    public get onDidChange() { return this._onDidChange.event; }

    public provideTextDocumentContent(uri: Uri): string | PromiseLike<string> {
        const document = window.activeTextEditor.document;
        if (document.languageId !== "ecmarkup"
            && document.languageId !== "html") {
            return `<body>ECMArkup Preview is only valid for HTML documents.</body>`;
        }

        return build(document.fileName, fetch, { copyright: false, toc: false }).then(processSpec);

        function fetch(file: string) {
            return new Promise<string>((resolve, reject) => {
                if (file === document.fileName) {
                    resolve(window.activeTextEditor.document.getText());
                }
                else {
                    fs.readFile(file, "utf8", (err, data) => err ? reject(err) : resolve(data));
                }
            });
        }

        function processSpec(spec: Spec) {
            const html = spec.toHTML();
            const lines = html.split(/\r?\n/g);
            const doctype = /^\s*<!doctype\b/.test(lines[0]) ? lines.shift() : undefined;
            lines.unshift(`<style>
    body { background-color: white; }
</style>
<link rel="stylesheet" href="${require.resolve("ecmarkup/css/elements.css")}" />`);
            if (doctype) {
                lines.unshift(doctype);
            }
            return lines.join("\n");
        }
    }

    public update(uri: Uri) {
        this._onDidChange.fire(uri);
    }
}