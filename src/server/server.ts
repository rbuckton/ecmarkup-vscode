import { Event, Emitter } from "vscode-jsonrpc";
import { IConnection, TextDocument, TextDocuments, InitializeParams, InitializeResult, TextDocumentChangeEvent, TextDocumentPositionParams, Definition, ReferenceParams, Location, Range, Position, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { Query, Queryable } from "iterable-query";
import { parse as parseHtml, ASTNode, LocationInfo, ElementLocationInfo } from "parse5";
import { extractFragment } from "./html";
import { TextDocumentWithSourceMap } from "./textDocument";
import { SourceMap, SourceRange, SourcePosition, Bias } from "./sourceMap";
import * as gmd from "grammarkdown";
import * as yaml from "js-yaml";
import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as os from "os";

const ASTNodeHierarchy = {
    parent(node: ASTNode) { return node.parentNode; },
    children(node: ASTNode) { return node.childNodes; }
};

class SpecDocument {
    public uri: string;
    public textDocument: TextDocument;
    public htmlDocument: ASTNode;
}

export class Server {
    private connection: IConnection;
    private workspaceRoot: string;
    private grammar: gmd.Grammar;
    private openDocuments: TextDocuments;
    private otherDocuments: Map<string, TextDocument>;
    private specDocuments: Map<string, ASTNode>;
    private grammarDocuments: Map<string, TextDocument>;
    private pendingRequests: Map<string, Set<PendingRequest>>;

    constructor() {
        this.openDocuments = new TextDocuments();
        this.openDocuments.onDidChangeContent(change => this.onDidChangeContent(change.document));
        this.openDocuments.onDidClose(change => this.onDidClose(change.document));
        this.otherDocuments = new Map<string, TextDocument>();
        this.specDocuments = new Map<string, ASTNode>();
        this.grammarDocuments = new Map<string, TextDocument>();
        this.pendingRequests = new Map<string, Set<PendingRequest>>();
    }

    public listen(connection: IConnection) {
        this.connection = connection;
        this.connection.onInitialize(params => this.onInitialize(params));
        this.connection.onDefinition(params => this.onDefinition(params));
        this.connection.onReferences(params => this.onReferences(params));
        this.openDocuments.listen(connection);
    }

    private onInitialize(params: InitializeParams): InitializeResult {
        this.workspaceRoot = ensureTrailingSeparator(normalizeSlashes(params.rootPath));
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
            const grammarDocument = this.grammarDocuments.get(uri);
            const sourceFile = grammar.getSourceFile(uri);
            const resolver = grammar.resolver;
            const navigator = resolver.createNavigator(sourceFile);
            const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(grammarDocument, SourcePosition.create(uri, position));
            if (navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                declarations = resolver.getDeclarations(<gmd.Identifier>navigator.getNode());
            }
            return this.getLocationsOfNodes(declarations, resolver);
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }
    }

    private onReferences({ textDocument: { uri }, position }: ReferenceParams) {
        try {
            this.trace(`find references...`);
            let references: gmd.Node[];
            const grammar = this.getGrammar();
            const grammarDocument = this.grammarDocuments.get(uri);
            const sourceFile = grammar.getSourceFile(uri);
            const resolver = grammar.resolver;
            const navigator = resolver.createNavigator(sourceFile);
            const generatedPosition = TextDocumentWithSourceMap.generatedPositionFor(grammarDocument, SourcePosition.create(uri, position));
            if (navigator.moveToPosition(generatedPosition) && navigator.moveToName()) {
                references = resolver.getReferences(<gmd.Identifier>navigator.getNode());
            }
            return this.getLocationsOfNodes(references, resolver);
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }
    }

    private onDidChangeContent(textDocument: TextDocument) {
        try {
            this.trace(`detected change in '${textDocument.uri}'...`);
            if (this.processDocument(textDocument)) {
                // this.processRequests(textDocument)
                //     .then(() => {
                //         this.checkDocument(textDocument);
                //         this.trace(`done processing '${textDocument.uri}'.`);
                //     })
                //     .catch(e => {
                //         this.trace(`error: ${e}`);
                //     });
                // this.checkDocument(textDocument);
                // this.trace(`almost done processing '${textDocument.uri}'...`);
                // return;
            }

            this.checkDocument(textDocument);
            this.trace(`done processing '${textDocument.uri}'.`);
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
                    this.specDocuments.delete(textDocument.uri);
                    this.grammarDocuments.delete(textDocument.uri);
                    this.grammar = undefined;
                    break;

                case "grammarkdown":
                    this.grammarDocuments.delete(textDocument.uri);
                    this.grammar = undefined;
                    break;
            }

            this.otherDocuments.delete(textDocument.uri);
        }
        catch (e) {
            this.trace(`error: ${e.stack}`);
        }
    }

    private processDocument(textDocument: TextDocument) {
        this.trace(`processing '${textDocument.uri}'...`);
        this.otherDocuments.set(textDocument.uri, textDocument);
        if (textDocument.languageId === "ecmarkup" || textDocument.languageId === "html") {
            return this.processSpecDocument(textDocument);
        }
        else if (textDocument.languageId === "grammarkdown") {
            return this.processGrammarDocument(textDocument);
        }
    }

    private processSpecDocument(textDocument: TextDocument) {
        const htmlDocument = this.parseHtmlDocument(textDocument);
        const hasPendingRequests = this.processImports(textDocument, htmlDocument);
        const metadata = this.getMetadata(textDocument, htmlDocument);
        const strict = metadata.grammar === "strict";
        this.processEmbeddedGrammarDocument(textDocument, htmlDocument, strict);
        this.specDocuments.set(textDocument.uri, htmlDocument);
        this.trace(`spec '${textDocument.uri}' added.`);
        return hasPendingRequests;
    }

    private getMetadata(textDocument: TextDocument, document: ASTNode) {
        const pre = hierarchy(document)
            .descendants(node => node.nodeName === "pre" && getAttribute(node, "class") === "metadata")
            .first();
        if (pre) {
            const location = <ElementLocationInfo>pre.__location;
            const meta = extractFragment(textDocument, location.startTag.endOffset, location.endTag.startOffset);
            return yaml.load(meta.getText());
        }
        return {};
    }

    private processImports(textDocument: TextDocument, document: ASTNode) {
        this.trace(`processing '${textDocument.uri}' imports...`);
        const links = hierarchy(document)
            .descendants(node => node.nodeName === "link")
            .toArray();

        let hasPendingRequests = false;
        for (const link of links) {
            const relAttr = link.attrs.find(attr => attr.name === "rel");
            if (!relAttr) continue;

            const hrefAttr = link.attrs.find(attr => attr.name === "href");
            if (!hrefAttr) continue;

            switch (relAttr.value.toLowerCase()) {
                case "spec":
                    if (this.processSpecImport(textDocument, hrefAttr.value)) {
                        hasPendingRequests = true;
                    }
                    break;

                case "grammar":
                    if (this.processGrammarImport(textDocument, hrefAttr.value)) {
                        hasPendingRequests = true;
                    }
                    break;
            }
        }

        return hasPendingRequests;
    }

    private processSpecImport(textDocument: TextDocument, href: string) {
        this.trace(`processing '${textDocument.uri}' spec import of '${href}'...`)
        switch (href.toLowerCase()) {
            case "es6":
            case "es2015":
                href = path.join(__dirname, "../../specs/es2015.spec.html");
                break;
        }

        href = toUrl(href, textDocument.uri);
        if (!this.specDocuments.has(href)) {
            if (isFileUrl(href)) {
                const textDocument = this.getTextDocument(href);
                if (textDocument) {
                    this.specDocuments.set(href, undefined);
                    try {
                        this.processSpecDocument(textDocument);
                    }
                    catch (e) {
                        this.specDocuments.delete(href);
                        throw e;
                    }
                }
            }
            else if (isUrl(href)) {
                this.enqueueRequest(textDocument, "spec", href);
                return true;
            }
        }
        return false;
    }

    private processGrammarImport(textDocument: TextDocument, href: string) {
        this.trace(`processing '${textDocument.uri}' grammar import of '${href}'...`);
        href = toUrl(href, textDocument.uri);
        if (!this.grammarDocuments.has(href)) {
            if (isFileUrl(href)) {
                const textDocument = this.getTextDocument(href);
                if (textDocument) {
                    this.grammarDocuments.set(href, undefined);
                    try {
                        this.processGrammarDocument(textDocument);
                    }
                    catch (e) {
                        this.grammarDocuments.delete(href);
                        throw e;
                    }
                }
            }
            else if (isUrl(href)) {
                this.enqueueRequest(textDocument, "grammar", href);
                return true;
            }
        }
        return false;
    }

    private processEmbeddedGrammarDocument(textDocument: TextDocument, htmlDocument: ASTNode, strict: boolean) {
        const grammarNodes = getGrammarNodes(htmlDocument, strict);
        if (grammarNodes.length === 0) return;

        const fragments = grammarNodes.map(grammarNode => {
            const location = <ElementLocationInfo>grammarNode.__location;
            const fragmentDocument = extractFragment(textDocument, location.startTag.endOffset, location.endTag.startOffset);
            return fragmentDocument;
        });

        const grammarDocument = TextDocumentWithSourceMap.concat(textDocument.uri, "grammarkdown", 0, fragments);
        this.grammarDocuments.set(textDocument.uri, grammarDocument);
        this.grammar = undefined;
        this.trace(`grammar '${textDocument.uri}' added.`);
    }

    private processGrammarDocument(textDocument: TextDocument) {
        this.grammarDocuments.set(textDocument.uri, textDocument);
        this.grammar = undefined;
        this.trace(`grammar '${textDocument.uri}' added.`);
        return false;
    }

    private enqueueRequest(textDocument: TextDocument, rel: string, href: string) {
        this.trace(`enqueuing '${href}'...`);
        let pendingRequests = this.pendingRequests.get(textDocument.uri);
        if (!pendingRequests) {
            this.pendingRequests.set(textDocument.uri, pendingRequests = new Set<PendingRequest>());
        }

        pendingRequests.add({ rel, href });
    }

    private processRequests(textDocument: TextDocument) {
        this.trace(`processing '${textDocument.uri}' pending requests...`);
        return new Promise<void>((resolve, reject) => {
            const pendingRequests = this.pendingRequests.get(textDocument.uri);
            for (const pendingRequest of Array.from(pendingRequests)) {
                const parsed = url.parse(pendingRequest.href);
                (parsed.protocol === "http:" ? http.get : https.get)(parsed, response => {
                    let content = "";
                    response.setEncoding("utf8");
                    response.on("data", data => { content += data; });
                    response.on("end", () => {
                        const textDocument = this.createRelatedTextDocument(pendingRequest.href, pendingRequest.rel, content);
                        if (this.processDocument(textDocument)) {
                            this.processRequests(textDocument)
                                .then(() => {
                                    pendingRequests.delete(pendingRequest);
                                    if (pendingRequests.size === 0) {
                                        resolve();
                                    }
                                });
                            return;
                        }

                        pendingRequests.delete(pendingRequest);
                        if (pendingRequests.size === 0) {
                            resolve();
                        }
                    });
                });
            }
        });
    }

    private checkDocument(textDocument: TextDocument) {
        const diagnostics: Diagnostic[] = [];
        this.checkGrammar(textDocument, diagnostics);
        this.trace(`sending '${textDocument.uri}' diagnostics...`);
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
                const grammarDocument = sourceFile && this.grammarDocuments.get(sourceFile.filename);
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
                const rootNames = Array.from(this.grammarDocuments.keys());

                // check the grammar
                const options: gmd.CompilerOptions = {};
                const host: gmd.Host = {
                    normalizeFile: toUrl,
                    resolveFile: (file, referer) => {
                        switch (file.toLowerCase()) {
                            case "es6":
                            case "es2015":
                                return toUrl(path.join(__dirname, "../../grammars/es2015.grammar"));
                        }

                        return toUrl(file, referer);
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
        let textDocument = this.grammarDocuments.get(file);
        if (!textDocument && isFileUrl(file)) {
            textDocument = this.getTextDocument(file);
            if (textDocument) {
                this.processGrammarDocument(textDocument);
                textDocument = this.grammarDocuments.get(file);
            }
        }
        const text = textDocument ? textDocument.getText() : undefined;
        this.trace(`grammar '${file}' ${textDocument ? "found" : "missing"}.`);
        return text;
    }

    private parseHtmlDocument(textDocument: TextDocument) {
        return parseHtml(textDocument.getText(), { locationInfo: true });
    }

    private createRelatedTextDocument(href: string, rel: string, content: string) {
        switch (rel) {
            case "spec":
                return this.createTextDocument(href, "ecmarkup", content);

            case "grammar":
                return this.createTextDocument(href, "grammarkdown", content);
        }
    }

    private createTextDocument(href: string, languageId: string, content: string) {
        const textDocument = TextDocument.create(href, languageId, 0, content);
        this.otherDocuments.set(href, textDocument);
        return textDocument;
    }

    private getTextDocument(href: string) {
        if (!this.otherDocuments.has(href)) {
            if (isFileUrl(href)) {
                try {
                    const content = fs.readFileSync(toLocalPath(href), "utf8");
                    const textDocument = TextDocument.create(href, "grammarkdown", 0, content);
                    this.otherDocuments.set(textDocument.uri, textDocument);
                    return textDocument;
                }
                catch (e) {
                    this.trace(`file not found: ${toLocalPath(href)}`);
                }
            }
            else {
                this.trace(`unrecognized url: '${href}'`)
            }
        }

        return this.otherDocuments.get(href);
    }

    private getLocationsOfNodes(nodes: gmd.Node[], resolver: gmd.Resolver) {
        const locations: Location[] = [];
        if (nodes) {
            for (const node of nodes) {
                const navigator = resolver.createNavigator(node);
                if (navigator && navigator.moveToName()) {
                    const sourceFile = navigator.getRoot();
                    let grammarDocument = this.grammarDocuments.get(sourceFile.filename);
                    if (!grammarDocument) {
                        grammarDocument = TextDocument.create(sourceFile.filename, "grammarkdown", 0, sourceFile.text);
                        this.grammarDocuments.set(sourceFile.filename, grammarDocument);
                    }

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

interface PendingRequest {
    rel: string;
    href: string;
}

function hasAttribute(node: ASTNode, name: string) {
    return !!node.attrs && !!node.attrs.find(attr => attr.name === name);
}

function getAttribute(node: ASTNode, name: string) {
    const attr = node.attrs && node.attrs.find(attr => attr.name === name);
    return attr ? attr.value : undefined;
}

function getGrammarNodes(document: ASTNode, strict?: boolean) {
    return hierarchy(document)
        .descendants(node => node.nodeName === "emu-grammar"
            && strict ? !hasAttribute(node, "relaxed") : hasAttribute(node, "strict"))
        .toArray();
}

function hierarchy(node: ASTNode) {
    return Query.hierarchy(node, ASTNodeHierarchy);
}

function from(source: Queryable<ASTNode>) {
    return Query.from(source).toHierarchy(ASTNodeHierarchy);
}

function isUrl(value: string) {
    const parsed = url.parse(value);
    return !!parsed.protocol && !path.isAbsolute(value);
}

function isFileUrl(value: string) {
    const parsed = url.parse(value);
    return parsed.protocol === "file:";
}

function toUrl(value: string, referer?: string) {
    if (path.isAbsolute(value)) {
        value = normalizeSlashes(value).split(/\//g).map(encodeURIComponent).join("/");
        return url.format({ protocol: "file:", slashes: true, pathname: value });
    }

    return referer ? url.resolve(referer, value) : value;
}

function toLocalPath(value: string) {
    if (path.isAbsolute(value)) {
        return value;
    }

    const parsed = url.parse(value);
    if (parsed.protocol === "file:") {
        const pathname = decodeURIComponent(parsed.pathname);
        return /^[\\/][a-z]:/i.test(pathname) ? pathname.slice(1) : pathname;
    }

    return undefined;
}

function normalizeSlashes(text: string) {
    return text.replace(/\\/g, "/");
}

function ensureTrailingSeparator(text: string) {
    return /[\\/]$/.test(text) ? text : text + "/";
}
