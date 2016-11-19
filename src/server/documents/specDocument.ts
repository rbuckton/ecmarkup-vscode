import { TextDocument, Position } from "vscode-languageserver";
import { DocumentBase } from "./documentBase";
import { DocumentManager } from "./documentManager";
import { GrammarDocument } from "./grammarDocument";
import { EmuSpec, EmuNode, Metadata } from "../nodes";
import { Query } from "iterable-query";
import { CountdownEvent } from "prex";
import { parseSpec } from "../parser";
import { fetchString } from "../fetch";
import { TraceSwitch } from "../utils";
import * as utils from "../utils";
import * as fs from "fs";
import * as path from "path";

const trace = new TraceSwitch("ecmarkup-vscode-specdocument");

const knownSpecs = new Map<string, string>();
knownSpecs.set("es6", path.join(__dirname, "../../../specs/es2015.spec.html"));
knownSpecs.set("es2015", path.join(__dirname, "../../../specs/es2015.spec.html"));

export class SpecDocument extends DocumentBase {
    private _textDocument: TextDocument;
    private _spec: EmuSpec;
    private _metadata: Metadata;
    private _grammarFragments: GrammarDocument[];

    constructor(documents: DocumentManager, uri: string, textDocument?: TextDocument) {
        super(documents, uri);
        if (textDocument) {
            this.continueWithTextDocument(textDocument);
        }
        else {
            this.fetch();
        }
    }

    public get textDocument() {
        this.throwIfNotReady();
        return this._textDocument;
    }

    public get metadata() {
        this.throwIfNotReady();
        return this._metadata;
    }

    public get grammarFragments() {
        this.throwIfNotReady();
        return this._grammarFragments;
    }

    public get namespaces() {
        this.throwIfNotReady();
        return this._spec.namespaces;
    }

    public nodeAt(position: Position) {
        this.throwIfNotReady();
        const index = this._spec.sortedNodes.indexOfKey(position);
        return this._spec.sortedNodes.valueAt(index < 0 ? ~index : index);
    }

    public namespaceAt(position: Position) {
        this.throwIfNotReady();
        const node = this.nodeAt(position);
        return node && node.namespace || "";
    }

    private fetch() {
        trace.log(`fetch(${this.uri})`);
        try {
            let file: string;
            if (utils.isFileUrl(this.uri)) {
                file = utils.toLocalPath(this.uri);
            }
            else if (utils.isUrl(this.uri)) {
                fetchString(this.uri, this.cancellationToken)
                    .then(content => this.continueWithTextContent(content))
                    .catch(e => this.setError(e));
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
        trace.log(`continueWithTextContent(${this.uri})`);
        try {
            const textDocument = TextDocument.create(this.uri, "ecmarkup", 0, content);
            this.continueWithTextDocument(textDocument);
        }
        catch (e) {
            this.setError(e);
        }
    }

    private resolveHref(relationship: string, href: string) {
        if (relationship === "spec" && knownSpecs.has(href)) {
            href = knownSpecs.get(href);
        }
        return utils.toUrl(href, this.uri);
    }

    private getRelatedDocument(relationship: string, href: string): SpecDocument | GrammarDocument {
        href = this.resolveHref(relationship, href);
        switch (relationship) {
            case "spec": return this.documentManager.specDocuments.get(href);
            case "grammar": return this.documentManager.grammarDocuments.get(href, "");
        }
    }

    private continueWithTextDocument(textDocument: TextDocument) {
        trace.log(`continueWithTextDocument(${this.uri})`);
        try {
            this.setUri(textDocument.uri);
            this._textDocument = textDocument;

            this._spec = parseSpec(textDocument);
            this._metadata = this._spec.metadata;
            this._grammarFragments = [];

            // add grammar fragments
            for (const fragment of this._spec.grammars) {
                this._grammarFragments.push(this.documentManager.grammarDocuments.set(fragment.document.uri, fragment.namespace, fragment.document, this));
            }

            // TODO: revise import handling

            // parse imports
            const imports = Query
                .from(this._spec.imports)
                .select(({ href, range }) => ({ document: this.getRelatedDocument("spec", href), range }))
                .where(({ document }) => document !== undefined)
                .toArray();

            trace.log(`found ${imports.length} imports`);

            const links = Query
                .from(this._spec.links)
                .select(({ rel, href, range }) => ({ document: this.getRelatedDocument(rel, href), range }))
                .where(({ document }) => document !== undefined)
                .toArray();

            trace.log(`found ${links.length} links`);

            const allImports = imports.concat(links);

            const pendingImports = imports
                .filter(({ document }) => !document.ready);


            // TODO: handle immediate failed imports
            const immediateFailedImports = imports
                .filter(({ document }) => document.ready && document.error);

            // wait for any pending imports
            if (pendingImports.length === 0) {
                trace.log(`all imports satisfied`);
                this.setReady();
            }
            else {
                const remainingImports = new CountdownEvent(pendingImports.length);
                for (const { document } of pendingImports) {
                    // TODO: handle deferred failed imports
                    document
                        .waitForReady()
                        .then(() => remainingImports.signal(), e => remainingImports.signal());
                }

                trace.log(`waiting on ${pendingImports.length} pending imports`);
                remainingImports
                    .wait()
                    .then(() => this.setReady());
            }

            this.setReady();
        }
        catch (e) {
            trace.error(e.stack);
            this.setError(e);
        }
    }
}
