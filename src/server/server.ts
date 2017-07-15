import { IConnection, TextDocument, TextDocuments, InitializeParams, InitializeResult, TextDocumentChangeEvent, TextDocumentPositionParams, Definition, ReferenceParams, Location, Range, Diagnostic, DiagnosticSeverity, DidChangeConfigurationParams } from "vscode-languageserver";
import { TextDocumentWithSourceMap } from "./textDocument";
import { SourcePosition, Bias } from "./sourceMap";
import { DocumentManager } from "./documents/documentManager";
import { SpecDocument } from "./documents/specDocument";
import { GrammarDocument } from "./documents/grammarDocument";
import * as gmd from "grammarkdown";
import * as utils from "./utils";

export class Server {
    private connection: IConnection;
    private grammar: gmd.Grammar;
    private openDocuments: TextDocuments;
    private documentManager: DocumentManager;
    private traceLevel: "none" | "client" | "server" | "all";

    constructor() {
        this.openDocuments = new TextDocuments();
        this.openDocuments.onDidChangeContent(params => this.onDidChangeContent(params));
        this.openDocuments.onDidClose(params => this.onDidClose(params));

        this.documentManager = new DocumentManager();
        this.documentManager.specDocuments.on("documentAdded", () => this.grammar = undefined);
        this.documentManager.specDocuments.on("documentDeleted", () => this.grammar = undefined);
        this.documentManager.grammarDocuments.on("documentAdded", () => this.grammar = undefined);
        this.documentManager.grammarDocuments.on("documentDeleted", () => this.grammar = undefined);
    }

    public listen(connection: IConnection) {
        this.connection = connection;
        this.connection.onInitialize(params => this.onInitialize(params));
        this.connection.onDidChangeConfiguration(params => this.onDidChangeConfiguration(params));
        this.connection.onDefinition(params => this.onDefinition(params));
        this.connection.onReferences(params => this.onReferences(params));
        this.openDocuments.listen(connection);
        this.documentManager.listen(connection);
        this.trace(`server started`);
    }

    private onInitialize({ }: InitializeParams): InitializeResult {
        return {
            capabilities: {
                textDocumentSync: this.openDocuments.syncKind,
                definitionProvider: true,
                referencesProvider: true
            }
        };
    }

    private onDidChangeConfiguration({ settings }: DidChangeConfigurationParams) {
        this.traceLevel = settings.ecmarkup.trace || "none";
    }

    private onDidChangeContent({ document }: TextDocumentChangeEvent) {
        try {
            const specDocument = this.documentManager.specDocuments.addOrUpdate(document.uri, document);
            if (!specDocument.ready) {
                specDocument
                    .waitForReady()
                    .then(
                        () => {
                            this.checkDocument(document);
                        },
                        (e) => {
                            this.checkDocument(document);
                            this.trace(`error: ${e.stack}`);
                        });
                return;
            }

            this.checkDocument(document);
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }
    }

    private onDidClose({ document }: TextDocumentChangeEvent) {
        try {
            switch (document.languageId) {
                case "ecmarkup":
                case "html":
                    this.documentManager.specDocuments.delete(document.uri);
                    break;

                case "grammarkdown":
                    this.documentManager.grammarDocuments.delete(document.uri);
                    break;
            }
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }
    }

    private onDefinition({ textDocument: { uri }, position }: TextDocumentPositionParams) {
        try {
            let declarations: (gmd.SourceFile | gmd.Production | gmd.Parameter)[];
            const grammar = this.getGrammar();
            const grammarDocument = this.documentManager.grammarDocuments.get(uri).textDocument;
            if (grammarDocument) {
                const sourceFile = grammar.getSourceFile(uri);
                const resolver = grammar.resolver;
                const navigator = resolver.createNavigator(sourceFile);
                const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(grammarDocument, SourcePosition.create(uri, position));
                if (generatedPosition && navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                    declarations = resolver.getDeclarations(<gmd.Identifier>navigator.getNode());
                }

                return this.getLocationsOfNodes(declarations, resolver);
            }
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }

        return [];
    }

    private onReferences({ textDocument: { uri }, position }: ReferenceParams) {
        try {
            let references: gmd.Node[];
            const grammar = this.getGrammar();
            const grammarDocument = this.documentManager.grammarDocuments.get(uri).textDocument;
            if (grammarDocument) {
                const sourceFile = grammar.getSourceFile(uri);
                const resolver = grammar.resolver;
                const navigator = resolver.createNavigator(sourceFile);
                const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(grammarDocument, SourcePosition.create(uri, position));
                if (generatedPosition && navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                    references = resolver.getReferences(<gmd.Identifier>navigator.getNode());
                }

                return this.getLocationsOfNodes(references, resolver);
            }
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }

        return [];
    }

    private checkDocument(textDocument: TextDocument) {
        const diagnostics: Diagnostic[] = [];
        this.checkGrammar(textDocument, diagnostics);
        this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
    }

    private checkGrammar(textDocument: TextDocument, diagnostics: Diagnostic[]) {
        const grammar = this.getGrammar();
        const grammarFile = grammar.getSourceFile(textDocument.uri);

        grammar.check(grammarFile);

        // traverse diagnostics
        if (grammar.diagnostics.count()) {
            const infos = grammar.diagnostics.getDiagnosticInfos({ formatMessage: true, detailedMessage: false });
            for (const { code, warning, range, formattedMessage: message, node, pos, sourceFile } of infos) {
                const grammarDocument = sourceFile && this.documentManager.grammarDocuments.get(sourceFile.filename).textDocument;
                if (!grammarDocument) continue;

                const severity = warning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
                const adjustedRange = TextDocumentWithSourceMap.sourceRangeFor(grammarDocument, range);
                diagnostics.push({ code, severity, range: adjustedRange ? adjustedRange.range : range, message });
            }
        }
    }

    private getGrammar() {
        if (!this.grammar) {
            try {
                // get root names and imported grammars
                const rootNames = Array.from(this.documentManager.grammarDocuments.keys());

                // check the grammar
                const options: gmd.CompilerOptions = {};
                const host: gmd.Host = {
                    normalizeFile: utils.toUrl,
                    resolveFile: (file, referer) => utils.toUrl(file, referer),
                    readFile: file => this.readGrammarFile(file),
                    writeFile: (file, content) => { }
                };
                this.grammar = new gmd.Grammar(rootNames, options, host);
                this.grammar.bind();
            }
            catch (e) {
                this.trace(`error: ${e.stack}`);
                throw e;
            }
        }

        return this.grammar;
    }

    private readGrammarFile(file: string) {
        const textDocument = this.documentManager.grammarDocuments.get(file).textDocument;
        return textDocument ? textDocument.getText() : undefined;
    }

    private getLocationsOfNodes(nodes: gmd.Node[], resolver: gmd.Resolver) {
        const locations: Location[] = [];
        if (nodes) {
            for (const node of nodes) {
                const navigator = resolver.createNavigator(node);
                if (navigator && navigator.moveToName()) {
                    const sourceFile = navigator.getRoot();
                    const grammarDocument = this.documentManager.grammarDocuments.get(sourceFile.filename).textDocument;
                    const name = <gmd.Identifier>navigator.getNode();
                    const isQuotedName = name.text.length + 2 === name.end - name.pos;
                    const start = grammarDocument.positionAt(isQuotedName ? name.pos + 1 : name.pos);
                    const end = grammarDocument.positionAt(isQuotedName ? name.end - 1 : name.end);
                    const range = Range.create(
                        TextDocumentWithSourceMap.sourcePositionFor(grammarDocument, start).position,
                        TextDocumentWithSourceMap.sourcePositionFor(grammarDocument, end).position);
                    locations.push(Location.create(grammarDocument.uri, range));
                }
            }
        }

        return locations;
    }

    private trace(message: string) {
        if (this.traceLevel === "server" || this.traceLevel === "all") {
            console.log(message);
            this.connection.console.log(`ecmarkup-vscode-server: ${message}`);
        }
    }
}