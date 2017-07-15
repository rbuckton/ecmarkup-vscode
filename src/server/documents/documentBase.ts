import { DocumentManager } from "./documentManager";
import { Deferred } from "prex";

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