import { TextDocument, Position } from "vscode-languageserver";
import { DocumentManager } from "./documentManager";
import { EventEmitter } from "events";
import { SpecDocument } from "./specDocument";
import { GrammarDocument } from "./grammarDocument";
import { CountdownEvent } from "prex";
import { Query } from "iterable-query";
import { TraceSwitch } from "../utils";

const trace = new TraceSwitch("ecmarkup-vscode-grammardocuments", /*enabled*/ false);

interface Namespace {
    documents: Map<string, GrammarDocument>;
    pending?: CountdownEvent;
}

export class GrammarDocuments extends EventEmitter {
    private _documentManager: DocumentManager;
    private _namespaces = new Map<string, Namespace>();

    constructor(documentManager: DocumentManager) {
        super();
        this._documentManager = documentManager;
    }

    public get size() { return this.getSize(); }
    public get ready() { return this.isReady(); }

    public getSize(namespace?: string) {
        if (namespace !== undefined) {
            if (this._namespaces.has(namespace)) {
                const ns = this._namespaces.get(namespace);
                return ns.documents.size;
            }
            return 0;
        }
        return Query
            .from(this._namespaces.keys())
            .reduce((c, namespace) => c + this.getSize(namespace), 0);
    }

    public isReady(namespace?: string) {
        if (namespace !== undefined) {
            if (this._namespaces.has(namespace)) {
                const ns = this._namespaces.get(namespace);
                return !ns.pending || ns.pending.remainingCount === 0;
            }
            return true;
        }
        return Query
            .from(this._namespaces.keys())
            .every(namespace => this.isReady(namespace));
    }

    public has(uri: string): boolean;
    public has(uri: string, namespace: string): boolean;
    public has(uri: string, namespace?: string) {
        if (namespace !== undefined) {
            if (this._namespaces.has(namespace)) {
                const ns = this._namespaces.get(namespace);
                return ns.documents.has(uri);
            }
            return false;
        }
        else {
            return Query
                .from(this._namespaces.values())
                .some(ns => ns.documents.has(uri));
        }
    }

    public get(uri: string): GrammarDocument[];
    public get(uri: string, namespace: string): GrammarDocument;
    public get(uri: string, namespace?: string): GrammarDocument | GrammarDocument[] {
        if (namespace !== undefined) {
            if (this._namespaces.has(namespace)) {
                const ns = this._namespaces.get(namespace);
                if (ns.documents.has(uri)) {
                    return ns.documents.get(uri);
                }
            }

            return this.addDocument(new GrammarDocument(this._documentManager, uri, namespace));
        }

        return Query
            .from(this._namespaces.values())
            .where(ns => ns.documents.has(uri))
            .select(ns => ns.documents.get(uri))
            .toArray();
    }

    public set(uri: string, namespace: string, textDocument: TextDocument, specDocument?: SpecDocument) {
        return this.addDocument(new GrammarDocument(this._documentManager, uri, namespace || "", textDocument, specDocument));
    }

    public deleteRange(documents: GrammarDocument[]) {
        for (const document of documents) {
            this.delete(document.uri, document.namespace);
        }
    }

    public delete(uri: string): boolean;
    public delete(uri: string, namespace: string): boolean;
    public delete(uri: string, namespace?: string) {
        if (namespace !== undefined) {
            if (this._namespaces.has(namespace)) {
                const ns = this._namespaces.get(namespace);
                if (ns.documents.has(uri)) {
                    const document = ns.documents.get(uri);
                    if (!document.ready) document.abort();

                    ns.documents.delete(uri);
                    if (ns.documents.size === 0) {
                        this._namespaces.delete(namespace);
                    }

                    this.emit("documentDeleted", document);
                    return true;
                }
            }

            return false;
        }
        else {
            let deleted = false;
            for (const namespace of Array.from(this._namespaces.keys())) {
                deleted = this.delete(uri, namespace) || deleted;
            }

            return deleted;
        }
    }

    public waitForReady(namespace?: string) {
        if (namespace !== undefined) {
            if (this._namespaces.has(namespace)) {
                const ns = this._namespaces.get(namespace);
                if (ns.pending) {
                    return ns.pending.wait();
                }
            }
        }
        else if (this._namespaces.size > 0) {
            return Promise.all(Query
                .from(this._namespaces.keys())
                .select(namespace => this.waitForReady(namespace)))
                .then(() => { });
        }
        return Promise.resolve();
    }

    public namespaces() {
        return this._namespaces.keys();
    }

    public keys(namespace: string): IterableIterator<string> {
        if (this._namespaces.has(namespace)) {
            return this._namespaces.get(namespace).documents.keys();
        }
        return [][Symbol.iterator]();
    }

    public values(namespace: string) {
        if (this._namespaces.has(namespace)) {
            return this._namespaces.get(namespace).documents.values();
        }
        return [][Symbol.iterator]();
    }

    public on(event: "documentAdded", cb: (document: GrammarDocument) => void): this;
    public on(event: "documentDeleted", cb: (document: GrammarDocument) => void): this;
    public on(event: string, cb: Function): this;
    public on(event: string, cb: Function) {
        super.on(event, cb);
        return this;
    }

    private addDocument(document: GrammarDocument) {
        trace.log(`addDocument(${document.uri}, ${document.namespace})`);

        if (!this._namespaces.has(document.namespace)) {
            this._namespaces.set(document.namespace, { documents: new Map<string, GrammarDocument>() });
        }

        const ns = this._namespaces.get(document.namespace);
        const documents = ns.documents;
        if (documents.has(document.uri)) {
            const existingDocument = documents.get(document.uri);
            if (!existingDocument.ready) {
                existingDocument.abort();
            }
        }

        documents.set(document.uri, document);
        if (!document.ready) {
            if (!ns.pending || ns.pending.remainingCount === 0) {
                ns.pending = new CountdownEvent(1);
            }
            else {
                ns.pending.add(1);
            }

            document.waitForReady().then(() => ns.pending.signal(), () => ns.pending.signal());
        }

        this.emit("documentAdded", document);
        return document;
    }
}
