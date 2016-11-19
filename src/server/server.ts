import { IConnection, TextDocument, TextDocuments, InitializeParams, InitializeResult, TextDocumentChangeEvent, TextDocumentPositionParams, Definition, ReferenceParams, Location, Range, Position, Diagnostic, DiagnosticSeverity, DidChangeConfigurationParams } from "vscode-languageserver";
import { TextDocumentWithSourceMap } from "./textDocument";
import { SourcePosition, SourceRange, Bias } from "./sourceMap";
import { DocumentManager, SpecDocument, GrammarDocument } from "./documents";
import { TraceSwitch } from "./utils";
import * as utils from "./utils";
import * as gmd from "grammarkdown";

const trace = new TraceSwitch("ecmarkup-vscode-server");

export class Server {
    private connection: IConnection;
    private grammars = new Map<string, gmd.Grammar>();
    private openDocuments: TextDocuments;
    private documentManager: DocumentManager;

    constructor() {
        this.openDocuments = new TextDocuments();
        this.openDocuments.onDidChangeContent(params => this.onDidChangeContent(params));
        this.openDocuments.onDidClose(params => this.onDidClose(params));

        this.documentManager = new DocumentManager();
        this.documentManager.specDocuments.on("documentAdded", () => this.grammars.clear());
        this.documentManager.specDocuments.on("documentDeleted", () => this.grammars.clear());
        this.documentManager.grammarDocuments.on("documentAdded", () => this.grammars.clear());
        this.documentManager.grammarDocuments.on("documentDeleted", () => this.grammars.clear());
    }

    public listen(connection: IConnection) {
        this.connection = connection;
        this.connection.onInitialize(params => this.onInitialize(params));
        this.connection.onDefinition(params => this.onDefinition(params));
        this.connection.onReferences(params => this.onReferences(params));
        this.openDocuments.listen(connection);
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

    private onDidChangeContent({ document }: TextDocumentChangeEvent) {
        trace.log(`onDidChangeContent(${document.uri})`);
        try {
            const specDocument = this.documentManager.specDocuments.set(document.uri, document);
            if (!specDocument.ready) {
                specDocument
                    .waitForReady()
                    .then(
                        () => {
                            this.checkDocument(document.uri);
                        },
                        (e) => {
                            trace.error(e.stack);
                            try {
                                this.checkDocument(document.uri);
                            }
                            catch (e) {
                                trace.error(e.stack);
                            }
                        });
                return;
            }

            this.checkDocument(document.uri);
        }
        catch (e) {
            trace.error(e.stack);
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
            trace.error(e.stack);
        }
    }

    private getGrammarDocumentAt(uri: string, position: Position) {
        let namespace = "";
        const specDocument = this.documentManager.specDocuments.get(uri);
        if (specDocument) {
            namespace = specDocument.namespaceAt(position);
        }

        return this.documentManager.grammarDocuments.get(uri, namespace);
    }

    private onDefinition({ textDocument: { uri }, position }: TextDocumentPositionParams) {
        try {
            let declarations: (gmd.SourceFile | gmd.Production | gmd.Parameter)[];
            const grammarDocument = this.getGrammarDocumentAt(uri, position);
            if (grammarDocument) {
                const grammar = this.getGrammar(grammarDocument.namespace);
                const textDocument = grammarDocument.textDocument;
                const sourceFile = grammar.getSourceFile(textDocument.uri);
                const resolver = grammar.resolver;
                const navigator = resolver.createNavigator(sourceFile);
                const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(textDocument, SourcePosition.create(uri, position));
                if (generatedPosition && navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                    declarations = resolver.getDeclarations(<gmd.Identifier>navigator.getNode());
                }

                return this.getLocationsOfNodes(declarations, resolver, grammarDocument.namespace);
            }
        }
        catch (e) {
            trace.error(e.stack);
        }

        return [];
    }

    private onReferences({ textDocument: { uri }, position }: ReferenceParams) {
        try {
            let references: gmd.Node[];
            const grammarDocument = this.getGrammarDocumentAt(uri, position);
            if (grammarDocument) {
                const grammar = this.getGrammar(grammarDocument.namespace);
                const sourceFile = grammar.getSourceFile(grammarDocument.uri);
                const textDocument = grammarDocument.textDocument;
                const resolver = grammar.resolver;
                const navigator = resolver.createNavigator(sourceFile);
                const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(textDocument, SourcePosition.create(uri, position));
                if (generatedPosition && navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                    references = resolver.getReferences(<gmd.Identifier>navigator.getNode());
                }

                return this.getLocationsOfNodes(references, resolver, grammarDocument.namespace);
            }
        }
        catch (e) {
            trace.error(e.stack);
        }

        return [];
    }

    private checkDocument(uri: string) {
        trace.log(`checkDocument(${uri})`);
        const diagnostics: Diagnostic[] = [];
        this.checkGrammar(uri, diagnostics);
        this.connection.sendDiagnostics({ uri, diagnostics });
    }

    private checkGrammar(uri: string, diagnostics: Diagnostic[]) {
        trace.log(`checkGrammar(${uri})`);
        const specDocument = this.documentManager.specDocuments.get(uri);

        trace.log(`document has ${specDocument.namespaces.length} namespaces.`);
        for (const namespace of specDocument.namespaces) {
            trace.log(`checking grammar for namespace=${namespace}`);

            const grammar = this.getGrammar(namespace);
            grammar.check();

            const infos = grammar.diagnostics.getDiagnosticInfos({ formatMessage: true, detailedMessage: false });
            trace.log(`found ${infos.length} diagnostics.`);

            for (const { code, warning, range, formattedMessage: message, node, pos, sourceFile } of infos) {
                const grammarDocument = sourceFile && this.documentManager.grammarDocuments.get(sourceFile.filename, namespace);
                const textDocument = grammarDocument ? grammarDocument.textDocument : undefined;
                if (!textDocument) continue;

                const severity = warning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
                const adjustedRange = TextDocumentWithSourceMap.sourceRangeFor(textDocument, range);
                diagnostics.push({ code, severity, range: adjustedRange ? adjustedRange.range : range, message });
            }
        }
    }

    private getGrammar(namespace: string) {
        trace.log(`getGrammar(${namespace})`);
        if (!this.grammars.has(namespace)) {
            try {
                // get root names and imported grammars
                const rootNames = Array.from(this.documentManager.grammarDocuments.keys(namespace));

                // check the grammar
                const options: gmd.CompilerOptions = {};
                const host: gmd.Host = {
                    normalizeFile: utils.toUrl,
                    resolveFile: (file, referer) => utils.toUrl(file, referer),
                    readFile: file => this.readGrammarFile(file, namespace),
                    writeFile: (file, content) => { }
                };

                const grammar = new gmd.Grammar(rootNames, options, host);
                grammar.bind();
                this.grammars.set(namespace, grammar);
            }
            catch (e) {
                trace.error(e.stack);
                throw e;
            }
        }

        return this.grammars.get(namespace);
    }

    private readGrammarFile(file: string, namespace: string) {
        const textDocument = this.documentManager.grammarDocuments.get(file, namespace).textDocument;
        return textDocument ? textDocument.getText() : undefined;
    }

    private getLocationsOfNodes(nodes: gmd.Node[], resolver: gmd.Resolver, namespace: string) {
        const locations: Location[] = [];
        if (nodes) {
            for (const node of nodes) {
                const navigator = resolver.createNavigator(node);
                if (navigator && navigator.moveToName()) {
                    const sourceFile = navigator.getRoot();
                    const grammarDocument = this.documentManager.grammarDocuments.get(sourceFile.filename, namespace).textDocument;
                    const name = <gmd.Identifier>navigator.getNode();
                    const isQuotedName = name.text.length + 2 === name.end - name.pos;
                    const start = grammarDocument.positionAt(isQuotedName ? name.pos + 1 : name.pos);
                    const end = grammarDocument.positionAt(isQuotedName ? name.end - 1 : name.end);
                    const range = TextDocumentWithSourceMap.sourceRangeFor(grammarDocument, Range.create(start, end));
                    trace.log(`${SourceRange.format(range)}`);
                    trace.log(JSON.stringify((<TextDocumentWithSourceMap>grammarDocument).sourceMap, undefined, "  "));
                    locations.push(range);
                }
            }
        }

        return locations;
    }
}