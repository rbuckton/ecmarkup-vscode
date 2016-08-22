import { workspace, Disposable, ExtensionContext, FileSystemWatcher, } from "vscode";
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, NodeModule, ForkOptions } from "vscode-languageclient";

export function activate(context: ExtensionContext) {
    const server = context.asAbsolutePath("out/server/index.js");
    const transport = TransportKind.ipc;
    const serverOptions: ServerOptions = {
        run: { module: server, transport },
        debug: { module: server, transport, options: { execArgv: ["--nolazy", "--debug=6004"] } }
    };
    const clientOptions: LanguageClientOptions = { documentSelector: ['ecmarkup'] };
    const client = new LanguageClient("ECMArkup Language Client", serverOptions, clientOptions)
    context.subscriptions.push(client.start());
}