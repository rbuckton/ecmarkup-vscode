import { TextDocument } from "vscode-languageserver";
import { EventEmitter } from "events";
import { CountdownEvent } from "prex";
import { DocumentManager } from "./documentManager";
import { GrammarDocument } from "./grammarDocument";
import { SpecDocument } from "./specDocument";

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
