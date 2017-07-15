import { DocumentBase } from "./documentBase";
import { TextDocument } from "vscode-languageserver";
import { Query } from "iterable-query";
import { TextDocumentWithSourceMap } from "../textDocument";
import { CancellationTokenSource, CountdownEvent } from "prex";
import { DocumentManager } from "./documentManager";
import { fetchString } from "../fetch";
import { parseSpec } from "../parser";
import * as utils from "../utils";
import * as fs from "fs";
import * as path from "path";

const knownSpecs = new Map<string, string>();
knownSpecs.set("es6", path.join(__dirname, "../../../specs/es2015.spec.html"));
knownSpecs.set("es2015", path.join(__dirname, "../../../specs/es2015.spec.html"));

export class SpecDocument extends DocumentBase {
    private _textDocument: TextDocument;
    private _metadata: any;
    private _metadataDocument: TextDocumentWithSourceMap;
    private _grammarDocument: TextDocumentWithSourceMap;
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

    private async fetch() {
        try {
            let file: string;
            if (utils.isFileUrl(this.uri)) {
                file = utils.toLocalPath(this.uri);
            }
            else if (utils.isUrl(this.uri)) {
                this._cts = new CancellationTokenSource();
                const content = await fetchString(this.uri, this._cts.token);
                this.continueWithTextContent(content);
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

    private async continueWithTextDocument(textDocument: TextDocument) {
        try {
            this._textDocument = textDocument;

            // parse metadata and extract grammar
            const { links, metadata, metadataDocument, grammarDocument } = parseSpec(textDocument);
            this._metadata = metadata;
            this._metadataDocument = metadataDocument;
            this._grammarDocument = grammarDocument;

            // parse grammar
            this.documentManager.grammarDocuments.addOrUpdate(this.uri, this);

            // parse imports
            const resolveSpec = (href: string) => knownSpecs.has(href) ? knownSpecs.get(href) : href;
            const getDocument = (rel: string, href: string) =>
                rel === "spec" ? this.documentManager.specDocuments.get(utils.toUrl(resolveSpec(href), this.uri)) :
                rel === "grammar" ? this.documentManager.grammarDocuments.get(utils.toUrl(href, this.uri)) :
                undefined;

            const imports = Query
                .from(links)
                .select(({ rel, href, location }) => ({ document: getDocument(rel, href), location }))
                .where(({ document }) => document !== undefined)
                .toArray();

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

                await remainingImports.wait();
                this.setReady();
            }
        }
        catch (e) {
            this.setError(e);
        }
    }
}
