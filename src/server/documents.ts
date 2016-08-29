import { IConnection, TextDocument } from "vscode-languageserver";
import { TextDocumentWithSourceMap } from "./textDocument";
import { ASTNode, ElementLocationInfo, parse } from "parse5";
import { Deferred, CountdownEvent, CancellationToken, CancellationTokenSource } from "prex";
import { fetchString } from "./fetch";
import { EventEmitter } from "events";
import { parseSpec } from "./parser";
import { Query } from "iterable-query";
import * as html from "./html";
import * as utils from "./utils";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const knownSpecs = new Map<string, string>();
knownSpecs.set("es6", path.join(__dirname, "../../specs/es2015.spec.html"));
knownSpecs.set("es2015", path.join(__dirname, "../../specs/es2015.spec.html"));

export class DocumentManager {
    private _specDocuments: SpecDocuments;
    private _grammarDocuments: GrammarDocuments;
    private _connection: IConnection;

    constructor() {
        this._specDocuments = new SpecDocuments(this);
        this._specDocuments.on("documentDeleted", document => { this._grammarDocuments.delete(document.uri); });
        this._grammarDocuments = new GrammarDocuments(this);
    }

    public get specDocuments() { return this._specDocuments; }
    public get grammarDocuments() { return this._grammarDocuments; }

    public listen(connection: IConnection) {
        this._connection = connection;
    }

    /*@internal*/
    trace(message: string) {
        if (this._connection) {
            this._connection.console.log(`ecmarkup-vscode-documentmanager: ${message}`);
        }

        console.log(`ecmarkup-vscode-documentmanager: ${message}`);
    }
}

export class SpecDocuments extends EventEmitter {
    private _documentManager: DocumentManager;
    private _documents = new Map<string, SpecDocument>();
    private _pendingDocuments = new CountdownEvent(0);

    constructor(documentManager: DocumentManager) {
        super();
        this._documentManager = documentManager;
    }

    public get size() { return this._documents.size; }
    public get ready() { return this._pendingDocuments.remainingCount === 0; }

    public has(uri: string) {
        return this._documents.has(uri);
    }

    public get(uri: string) {
        if (this._documents.has(uri)) {
            return this._documents.get(uri);
        }

        return this.addDocument(new SpecDocument(this._documentManager, uri));
    }

    public addOrUpdate(uri: string, textDocument: TextDocument) {
        if (this._documents.has(uri)) {
            const document = this._documents.get(uri);
            if (!document.ready) document.abort();
        }

        return this.addDocument(new SpecDocument(this._documentManager, textDocument));
    }

    public delete(uri: string) {
        if (this._documents.has(uri)) {
            const document = this._documents.get(uri);
            if (!document.ready) document.abort();
            this._documents.delete(uri);
            this.emit("documentDeleted", document);
            return true;
        }

        return false;
    }

    public waitForReady() {
        return this._pendingDocuments.wait();
    }

    public keys() {
        return this._documents.keys();
    }

    public values() {
        return this._documents.values();
    }

    public on(event: "documentAdded", cb: (document: SpecDocument) => void): this;
    public on(event: "documentDeleted", cb: (document: SpecDocument) => void): this;
    public on(event: string, cb: Function): this;
    public on(event: string, cb: Function) {
        super.on(event, cb);
        return this;
    }

    private addDocument(document: SpecDocument) {
        this._documents.set(document.uri, document);
        if (!document.ready) {
            if (this._pendingDocuments.remainingCount === 0) {
                this._pendingDocuments.reset(1);
            }
            else {
                this._pendingDocuments.add(1);
            }

            document.waitForReady().then(() => this._pendingDocuments.signal(), () => this._pendingDocuments.signal());
        }

        this.emit("documentAdded", document);
        return document;
    }
}

export class GrammarDocuments extends EventEmitter {
    private _documentManager: DocumentManager;
    private _documents = new Map<string, GrammarDocument>();
    private _pendingDocuments = new CountdownEvent(0);

    constructor(documentManager: DocumentManager) {
        super();
        this._documentManager = documentManager;
    }

    public get size() { return this._documents.size; }
    public get ready() { return this._pendingDocuments.remainingCount === 0; }

    public has(uri: string) {
        return this._documents.has(uri);
    }

    public get(uri: string) {
        if (this._documents.has(uri)) {
            return this._documents.get(uri);
        }

        return this.addDocument(new GrammarDocument(this._documentManager, uri));
    }

    public addOrUpdate(uri: string, document: TextDocument | SpecDocument) {
        if (this._documents.has(uri)) {
            const document = this._documents.get(uri);
            if (!document.ready) document.abort();
        }

        return this.addDocument(new GrammarDocument(this._documentManager, document));
    }

    public delete(uri: string) {
        if (this._documents.has(uri)) {
            const document = this._documents.get(uri);
            if (!document.ready) document.abort();
            this._documents.delete(uri);
            this.emit("documentDeleted", document);
            return true;
        }

        return false;
    }

    public waitForReady() {
        return this._pendingDocuments.wait();
    }

    public keys() {
        return this._documents.keys();
    }

    public values() {
        return this._documents.values();
    }

    public on(event: "documentAdded", cb: (document: GrammarDocument) => void): this;
    public on(event: "documentDeleted", cb: (document: GrammarDocument) => void): this;
    public on(event: string, cb: Function): this;
    public on(event: string, cb: Function) {
        super.on(event, cb);
        return this;
    }

    private addDocument(document: GrammarDocument) {
        this._documents.set(document.uri, document);
        if (!document.ready) {
            if (this._pendingDocuments.remainingCount === 0) {
                this._pendingDocuments.reset(1);
            }
            else {
                this._pendingDocuments.add(1);
            }

            document.waitForReady().then(() => this._pendingDocuments.signal(), () => this._pendingDocuments.signal());
        }

        this.emit("documentAdded", document);
        return document;
    }
}

export abstract class DocumentBase {
    private _documentManager: DocumentManager;
    private _uri: string;
    private _ready = false;
    private _deferred = new Deferred<void>();
    private _error: any;

    constructor(documentManager: DocumentManager, uri: string) {
        this._documentManager = documentManager;
        this._uri = uri;
    }

    public get uri() { return this._uri; }
    public get ready() { return this._ready; }
    public get error() { return this._error; }

    protected get documentManager() { return this._documentManager; }

    public waitForReady() {
        return this._deferred.promise;
    }

    public abort() {
    }

    protected setReady() {
        if (!this._ready) {
            this._ready = true;
            this._deferred.resolve();
        }
    }

    protected setError(error: any) {
        if (!this._ready) {
            this._ready = true;
            this._error = error;
            this._deferred.reject(error);
            this.trace(`DocumentBase#setError: '${this.uri}': ${error.stack}`);
        }
    }

    protected trace(message: string) {
        this.documentManager.trace(message);
    }
}

export class SpecDocument extends DocumentBase {
    private _textDocument: TextDocument;
    private _metadata: any;
    private _metadataDocument: TextDocumentWithSourceMap;
    private _grammarDocument: TextDocumentWithSourceMap;
    // private _htmlDocument: ASTNode;
    private _cts: CancellationTokenSource;

    constructor(documents: DocumentManager, source: string | TextDocument) {
        if (utils.isString(source)) {
            super(documents, source);
            this.fetch();
        }
        else {
            super(documents, source.uri);
            this.continueWithTextDocument(source);
        }
    }

    public get textDocument() { return this._textDocument; }
    public get metadata() { return this._metadata; }
    public get metadataDocument() { return this._metadataDocument; }
    public get grammarDocument() { return this._grammarDocument; }

    public abort() {
        if (this._cts) {
            this._cts.cancel();
        }
    }

    private fetch() {
        try {
            let file: string;
            if (utils.isFileUrl(this.uri)) {
                file = utils.toLocalPath(this.uri);
            }
            else if (utils.isUrl(this.uri)) {
                this._cts = new CancellationTokenSource();
                fetchString(this.uri, this._cts.token).then(content => this.continueWithTextContent(content));
                return;
            }
            else {
                file = this.uri;
            }

            this.continueWithTextContent(fs.readFileSync(file, "utf8"));
        }
        catch (e) {
            this.setError(e);
        }
    }

    private continueWithTextContent(content: string) {
        try {
            const textDocument = TextDocument.create(this.uri, "ecmarkup", 0, content);
            this.continueWithTextDocument(textDocument);
        }
        catch (e) {
            this.setError(e);
        }
    }

    private continueWithTextDocument(textDocument: TextDocument) {
        try {
            this._textDocument = textDocument;

            // parse metadata and extract grammar
            const { links, metadata, metadataDocument, grammarDocument } = parseSpec(textDocument);
            this._metadata = metadata;
            this._metadataDocument = metadataDocument;
            this._grammarDocument = grammarDocument;

            // this._htmlDocument = parse(textDocument.getText(), { locationInfo: true });

            // // parse metadata
            // try {
            //     this._metadata = html.hierarchy(this._htmlDocument)
            //         .descendants(node => node.nodeName === "pre" && html.getAttribute(node, "class") === "metadata")
            //         .select(node => html.extractContent(textDocument, node))
            //         .select(fragment => yaml.safeLoad(fragment.getText(), <any>{
            //             filename: fragment.uri,
            //             onWarning: (content: string) => {
            //                 this.trace(`yaml parse error: ${content}`);
            //             }
            //         }))
            //         .first() || {};
            // }
            // catch (e) {
            //     // recover from errors parsing YAML
            //     this.trace(`error parsing YAML: ${e.stack}`);
            // }

            // parse grammar
            this.documentManager.grammarDocuments.addOrUpdate(this.uri, this);

            // parse imports

            const resolveSpec = (href: string) => knownSpecs.has(href) ? knownSpecs.get(href) : href;
            const getDocument = (rel: string, href: string) =>
                rel === "spec" ? this.documentManager.specDocuments.get(utils.toUrl(resolveSpec(href), this.uri)) :
                rel === "grammar" ? this.documentManager.grammarDocuments.get(utils.toUrl(href, this.uri)) :
                undefined;

            // const getDocument = (rel: string, href: string) =>
            //     html.getAttribute(node, "rel") === "spec" ? this.documentManager.specDocuments.get(utils.toUrl(resolveSpec(html.getAttribute(node, "href")), this.uri)) :
            //     html.getAttribute(node, "rel") === "grammar" ? this.documentManager.grammarDocuments.get(utils.toUrl(html.getAttribute(node, "href"), this.uri)) :
            //     undefined;

            const imports = Query
                .from(links)
                .select(({ rel, href, location }) => ({ document: getDocument(rel, href), location }))
                .where(({ document }) => document !== undefined)
                .toArray();

            // const imports = html.hierarchy(this._htmlDocument)
            //     .descendants(node => node.nodeName === "link"
            //         && html.hasAttribute(node, "rel")
            //         && html.hasAttribute(node, "href"))
            //     .select(node => ({ node, document: getDocument(node) }))
            //     .where(({ document }) => document !== undefined)
            //     .toArray();

            const pendingImports = imports
                .filter(({ document }) => !document.ready);

            // TODO: handle immediate failed imports
            const immediateFailedImports = imports
                .filter(({ document }) => document.ready && document.error);

            // wait for any pending imports
            if (pendingImports.length === 0) {
                this.setReady();
            }
            else {
                const remainingImports = new CountdownEvent(pendingImports.length);
                for (const { location, document } of pendingImports) {
                    // TODO: handle deferred failed imports
                    document
                        .waitForReady()
                        .then(() => remainingImports.signal(), e => remainingImports.signal());
                }

                remainingImports
                    .wait()
                    .then(() => this.setReady());
            }
        }
        catch (e) {
            this.setError(e);
        }
    }
}

export class GrammarDocument extends DocumentBase {
    private _textDocument: TextDocument;
    private _specDocument: SpecDocument;
    private _cts: CancellationTokenSource;

    constructor(documents: DocumentManager, source: string | TextDocument | SpecDocument) {
        if (utils.isString(source)) {
            super(documents, source);
            this.fetch();
        }
        else if (TextDocument.is(source)) {
            super(documents, source.uri);
            this.continueWithTextDocument(source);
        }
        else {
            super(documents, source.uri);
            this.continueWithSpecDocument(source);
        }
    }

    public get textDocument() { return this._textDocument; }

    public abort() {
        if (this._cts) {
            this._cts.cancel();
        }
    }

    private fetch() {
        try {
            let file: string;
            if (utils.isFileUrl(this.uri)) {
                file = utils.toLocalPath(this.uri);
            }
            else if (utils.isUrl(this.uri)) {
                this._cts = new CancellationTokenSource();
                fetchString(this.uri, this._cts.token).then(content => this.continueWithTextContent(content));
                return;
            }
            else {
                file = this.uri;
            }

            this.continueWithTextContent(fs.readFileSync(file, "utf8"));
        }
        catch (e) {
            this.setError(e);
        }
    }

    private continueWithTextContent(content: string) {
        try {
            const textDocument = TextDocument.create(this.uri, "grammarkdown", 0, content);
            this.continueWithTextDocument(textDocument);
        }
        catch (e) {
            this.setError(e);
        }
    }

    private continueWithTextDocument(textDocument: TextDocument) {
        try {
            this._textDocument = textDocument;
            this.setReady();
        }
        catch (e) {
            this.setError(e);
        }
    }

    private continueWithSpecDocument(specDocument: SpecDocument) {
        try {
            this._textDocument = specDocument.grammarDocument;
            this._specDocument = specDocument;
            if (specDocument.ready) {
                this.setReady();
            }
            else {
                specDocument
                    .waitForReady()
                    .then(() => this.setReady(), e => this.setError(e));
            }
        }
        catch (e) {
            this.setError(e);
        }
    }
}

// function getGrammarNodes(document: ASTNode, strict?: boolean) {
//     return html
//         .hierarchy(document)
//         .descendants(node => node.nodeName === "emu-grammar"
//             && strict ? !html.hasAttribute(node, "relaxed") : html.hasAttribute(node, "strict"))
//         .toArray();
// }