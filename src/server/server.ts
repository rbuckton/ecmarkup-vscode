import { IConnection, TextDocument, TextDocuments, InitializeParams, InitializeResult, TextDocumentChangeEvent, TextDocumentPositionParams, Definition, ReferenceParams, Location, Range, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocumentWithSourceMap } from "./textDocument";
import { parse as parseHtml, ASTNode, LocationInfo, ElementLocationInfo } from "parse5";
import { SourcePosition, Bias } from "./sourceMap";
import * as utils from "./utils";
import * as gmd from "grammarkdown";

import { DocumentManager, SpecDocument, GrammarDocument } from "./documents";

export class Server {
    private connection: IConnection;
    private workspaceRoot: string;
    private grammar: gmd.Grammar;
    private openDocuments: TextDocuments;
    private documentManager: DocumentManager;

    constructor() {
        this.openDocuments = new TextDocuments();
        this.openDocuments.onDidChangeContent(change => this.onDidChangeContent(change.document));
        this.openDocuments.onDidClose(change => this.onDidClose(change.document));

        this.documentManager = new DocumentManager();
        this.documentManager.specDocuments.on("documentAdded", () => this.grammar = undefined);
        this.documentManager.specDocuments.on("documentDeleted", () => this.grammar = undefined);
    }

    public listen(connection: IConnection) {
        this.connection = connection;
        this.connection.onInitialize(params => this.onInitialize(params));
        this.connection.onDefinition(params => this.onDefinition(params));
        this.connection.onReferences(params => this.onReferences(params));
        this.openDocuments.listen(connection);
        this.documentManager.listen(connection);
    }

    private onInitialize(params: InitializeParams): InitializeResult {
        this.workspaceRoot = utils.ensureTrailingSeparator(utils.normalizeSlashes(params.rootPath));
        return {
            capabilities: {
                textDocumentSync: this.openDocuments.syncKind,
                definitionProvider: true,
                referencesProvider: true
            }
        };
    }

    private onDefinition({ textDocument: { uri }, position }: TextDocumentPositionParams) {
        try {
            this.trace(`go to definition...`);
            let declarations: (gmd.SourceFile | gmd.Production | gmd.Parameter)[];
            const grammar = this.getGrammar();
            const grammarDocument = this.documentManager.grammarDocuments.get(uri).textDocument;
            if (grammarDocument) {
                const sourceFile = grammar.getSourceFile(uri);
                const resolver = grammar.resolver;
                const navigator = resolver.createNavigator(sourceFile);
                const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(grammarDocument, SourcePosition.create(uri, position));
                if (navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                    declarations = resolver.getDeclarations(<gmd.Identifier>navigator.getNode());
                }

                return this.getLocationsOfNodes(declarations, resolver);
            }

            this.trace(`no textDocument for grammar: ${uri}`);
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }

        return [];
    }

    private onReferences({ textDocument: { uri }, position }: ReferenceParams) {
        try {
            this.trace(`find references...`);
            let references: gmd.Node[];
            const grammar = this.getGrammar();
            const grammarDocument = this.documentManager.grammarDocuments.get(uri).textDocument;
            if (grammarDocument) {
                const sourceFile = grammar.getSourceFile(uri);
                const resolver = grammar.resolver;
                const navigator = resolver.createNavigator(sourceFile);
                const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(grammarDocument, SourcePosition.create(uri, position));
                if (navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                    references = resolver.getReferences(<gmd.Identifier>navigator.getNode());
                }

                return this.getLocationsOfNodes(references, resolver);
            }

            this.trace(`no textDocument for grammar: ${uri}`);
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }

        return [];
    }

    private onDidChangeContent(textDocument: TextDocument) {
        try {
            this.trace(`detected change in '${textDocument.uri}'...`);
            const specDocument = this.documentManager.specDocuments.addOrUpdate(textDocument.uri, textDocument);
            if (!specDocument.ready) {
                specDocument
                    .waitForReady()
                    .then(() => this.checkDocument(textDocument), () => this.checkDocument(textDocument));
                return;
            }

            this.checkDocument(textDocument);
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }
    }

    private onDidClose(textDocument: TextDocument) {
        try {
            switch (textDocument.languageId) {
                case "ecmarkup":
                case "html":
                    this.documentManager.specDocuments.delete(textDocument.uri);
                    this.documentManager.grammarDocuments.delete(textDocument.uri);
                    this.grammar = undefined;
                    break;

                case "grammarkdown":
                    this.documentManager.grammarDocuments.delete(textDocument.uri);
                    this.grammar = undefined;
                    break;
            }
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }
    }

    private checkDocument(textDocument: TextDocument) {
        const diagnostics: Diagnostic[] = [];
        this.checkGrammar(textDocument, diagnostics);
        this.trace(`sending ${diagnostics.length} '${textDocument.uri}' diagnostics...`);
        this.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
    }

    private checkGrammar(textDocument: TextDocument, diagnostics: Diagnostic[]) {
        const grammar = this.getGrammar();
        const grammarFile = grammar.getSourceFile(textDocument.uri);

        this.trace(`checking '${textDocument.uri}' grammar...`);
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
                    resolveFile: (file, referer) => {
                        // switch (file.toLowerCase()) {
                        //     case "es6":
                        //     case "es2015":
                        //         return toUrl(path.join(__dirname, "../../grammars/es2015.grammar"));
                        // }

                        return utils.toUrl(file, referer);
                    },
                    readFile: file => this.readGrammarFile(file),
                    writeFile: (file, content) => {}
                };

                this.trace(`creating grammar for ${rootNames}...`);
                this.grammar = new gmd.Grammar(rootNames, options, host);

                this.trace(`binding grammar...`);
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
        this.trace(`reading grammar '${file}'...`);
        const textDocument = this.documentManager.grammarDocuments.get(file).textDocument;
        const text = textDocument ? textDocument.getText() : undefined;
        this.trace(`grammar '${file}' ${textDocument ? "found" : "missing"}.`);
        return text;
    }

    private parseHtmlDocument(textDocument: TextDocument) {
        return parseHtml(textDocument.getText(), { locationInfo: true });
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
        console.log(message);
        this.connection.console.log(`ecmarkup-vscode-server: ${message}`);
    }
}