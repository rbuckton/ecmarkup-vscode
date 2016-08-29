import { workspace, window, commands, extensions, Uri, EventEmitter, ExtensionContext, TextDocumentContentProvider, ViewColumn, TextDocument } from "vscode";
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, NodeModule, ForkOptions, RequestType } from "vscode-languageclient";
import { CancellationToken, CancellationTokenSource, CancelError } from "prex";
import { build, Spec } from "ecmarkup";
import * as fs from "fs";
import * as path from "path";

declare module "vscode" {
    type Thenable<T> = PromiseLike<T>;
}

const previewDelay = 300; // ms

export namespace scheme {
    export const preview = "ecmarkup-preview";
}

export function activate(context: ExtensionContext) {
    const module = context.asAbsolutePath("out/server/index.js");
    const transport = TransportKind.ipc;
    const options: ForkOptions = { execArgv: ["--nolazy", "--debug=6005"] };
    const run: NodeModule = { module, transport };
    const debug: NodeModule = { module, transport, options };
    const serverOptions: ServerOptions = { run, debug };
    const clientOptions: LanguageClientOptions = { documentSelector: ["ecmarkup"], synchronize: { configurationSection: "ecmarkup" } };
    const client = new LanguageClient("ECMArkup Language Client", serverOptions, clientOptions);
    const provider = new EcmarkupDocumentContentProvider(context, client);

    context.subscriptions.push(
        client.start(),
        workspace.registerTextDocumentContentProvider("ecmarkup-preview", provider),
        commands.registerCommand("ecmarkup.showPreview", uri => showPreview(uri, /*showToSide*/ false)),
        commands.registerCommand("ecmarkup.showPreviewToSide", uri => showPreview(uri, /*showToSide*/ true)),
        commands.registerCommand("ecmarkup.showSource", uri => showSource(uri)));

    workspace.onDidSaveTextDocument((document) => {
        if (isEcmarkupDocument(document) && !isEcmarkupPreviewUri(document.uri)) {
            provider.update(getEcmarkupPreviewUri(document.uri));
        }
    })

    workspace.onDidChangeTextDocument(({ document }) => {
        if (isEcmarkupDocument(document) && !isEcmarkupPreviewUri(document.uri)) {
            provider.update(getEcmarkupPreviewUri(document.uri));
        }
    });

    workspace.onDidChangeConfiguration(() => {
        for (const document of workspace.textDocuments) {
            if (isEcmarkupPreviewUri(document.uri)) {
                provider.update(document.uri);
            }
        }
    });
}

export function isEcmarkupDocument(document: TextDocument) {
    return document.languageId === "ecmarkup" || document.languageId === "html";
}

export function isEcmarkupPreviewUri(uri: Uri) {
    return uri.scheme === "ecmarkup-preview";
}

export function getEcmarkupPreviewUri(uri: Uri) {
    return uri.scheme === "ecmarkup-preview" ? uri : uri.with({ scheme: "ecmarkup-preview", path: uri.path + ".rendered", query: uri.toString() });
}

export function getEcmarkupSourceUri(uri: Uri) {
    return uri.scheme === "ecmarkup-preview" ? Uri.parse(uri.query) : uri;
}

export function showPreview(uri?: Uri, showToSide = false): void | PromiseLike<{}> {
    if (!uri && window.activeTextEditor) {
        uri = window.activeTextEditor.document.uri;
    }
    if (!uri && !window.activeTextEditor) {
        return commands.executeCommand("ecmarkup.showSource");
    }
    if (!uri || isEcmarkupPreviewUri(uri)) {
        return;
    }
    return commands.executeCommand("vscode.previewHtml",
        getEcmarkupPreviewUri(uri),
        getViewColumn(showToSide),
        "HTML Preview (ecmarkup)");
}

export function showSource(uri: Uri): void | PromiseLike<{}> {
    if (!uri || !isEcmarkupPreviewUri(uri)) {
        return;
    }

    const sourceUri = getEcmarkupSourceUri(uri);
    for (const editor of window.visibleTextEditors) {
        if (editor.document.uri.toString() === sourceUri.toString()) {
            return window.showTextDocument(editor.document, editor.viewColumn);
        }
    }

    return workspace.openTextDocument(sourceUri).then(doc => window.showTextDocument(doc));
}

function getViewColumn(showToSide: boolean) {
    const viewColumn = window.activeTextEditor && window.activeTextEditor.viewColumn;
    if (viewColumn && showToSide) {
        switch (viewColumn) {
            case ViewColumn.One: return ViewColumn.Two;
            case ViewColumn.Two: return ViewColumn.Three;
        }
        return viewColumn;
    }
    return ViewColumn.One;
}

class EcmarkupDocumentContentProvider implements TextDocumentContentProvider {
    private _context: ExtensionContext;
    private _client: LanguageClient;
    private _cts: CancellationTokenSource;
    private _onDidChange = new EventEmitter<Uri>();
    private _pendingUpdateRequests = new Set<string>();
    private _pendingUpdates = new Map<string, CancellationTokenSource>();

    constructor(context: ExtensionContext, client: LanguageClient) {
        this._context = context;
        this._client = client;
    }

    public get onDidChange() { return this._onDidChange.event; }

    public provideTextDocumentContent(uri: Uri): string | PromiseLike<string> {
        const key = uri.toString();
        if (this._pendingUpdates.has(key)) {
            const cts = this._pendingUpdates.get(key);
            cts.cancel();
        }

        const cts = new CancellationTokenSource();
        this._pendingUpdates.set(key, cts);

        return workspace
            .openTextDocument(getEcmarkupSourceUri(uri))
            .then(document => {
                const fetch = (file: string, token: CancellationToken) => {
                    return new Promise<string>((resolve, reject) => {
                        token.throwIfCancellationRequested();
                        if (file === document.fileName) {
                            resolve(document.getText());
                            return;
                        }
                        fs.readFile(file, "utf8", (err, data) => err ? reject(err) : resolve(data));
                    });
                };
                return build(document.fileName, <any>fetch, { copyright: false, toc: false }, <any>cts.token)
                    .then(spec => {
                        if (this._pendingUpdates.get(key) === cts) {
                            this._pendingUpdates.delete(key);
                        }

                        const doc = (<any>spec).doc as HTMLDocument;
                        doc.head.insertAdjacentHTML("afterBegin", `<meta http-equiv="Content-type" content="text/html;charset=UTF-8" />`);
                        doc.head.insertAdjacentHTML("beforeEnd", `<link rel="stylesheet" href="${require.resolve("ecmarkup/css/elements.css")}" />`);
                        doc.head.insertAdjacentHTML("beforeEnd", `<link rel="stylesheet" href="${require.resolve("../../resources/preview.css")}" />`);
                        const styles = workspace.getConfiguration("ecmarkup")["styles"];
                        if (styles && Array.isArray(styles) && styles.length > 0) {
                            for (const style of styles) {
                                doc.head.insertAdjacentHTML("beforeEnd", `<link rel="stylesheet" href="${this.resolveUri(document.uri, style)}" media="screen" />`);
                            }
                        }
                        doc.head.insertAdjacentHTML("beforeEnd", `<base href="${document.uri.toString(true)}" />`);
                        return spec.toHTML();
                    });
            });
    }

    public update(uri: Uri) {
        const key = uri.toString();
        if (!this._pendingUpdateRequests.has(key)) {
            this._pendingUpdateRequests.add(key);
            setTimeout(() => {
                this._pendingUpdateRequests.delete(key);
                this._onDidChange.fire(uri);
            }, previewDelay);
        }
    }

    private resolveUri(baseUri: Uri, relative: string) {
        if (relative) {
            if (Uri.parse(relative).scheme) return relative;
            if (path.isAbsolute(relative)) return Uri.file(relative).toString();
            if (workspace.rootPath) return Uri.file(path.join(workspace.rootPath, relative)).toString();
            return Uri.file(path.join(path.dirname(baseUri.fsPath), relative)).toString();
        }
        return relative;
    }
}