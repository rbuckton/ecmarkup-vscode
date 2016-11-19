import { DocumentManager } from "./documentManager";
import { Deferred, CancellationTokenSource, CancelError } from "prex";
import { TraceSwitch } from "../utils";

const trace = new TraceSwitch("ecmarkup-vscode-documentbase", /*enabled*/ false);

export abstract class DocumentBase {
    private _documentManager: DocumentManager;
    private _uri: string;
    private _uris: string[];
    private _ready = false;
    private _deferred = new Deferred<void>();
    private _error: any;
    private _cts = new CancellationTokenSource();

    constructor(documentManager: DocumentManager, uri: string) {
        this._documentManager = documentManager;
        this._uri = uri;
        this._cts.register(() => { this.setCanceled(new CancelError()); });
    }

    public get uri() { return this._uri; }
    public get history(): ReadonlyArray<string> { return this._uris || (this._uris = []); }
    public get ready() { return this._ready; }
    public get error() { return this._error; }

    protected get documentManager() { return this._documentManager; }
    protected get cancellationToken() { return this._cts.token; }

    public waitForReady() {
        return this._deferred.promise;
    }

    public abort() {
        trace.log(`abort()`);
        this._cts.cancel();
    }

    protected setUri(uri: string) {
        if (this._uri !== uri) {
            trace.log(`setUri(${uri})`);
            if (!this._uris) {
                this._uris = [];
            }

            this._uris.push(this._uri);
            this._uri = uri;
        }
    }

    protected throwIfNotReady() {
        if (!this._ready) {
            throw new Error("Document not ready.");
        }
    }

    protected setReady() {
        if (!this._ready) {
            this._ready = true;
            this._deferred.resolve();
            this._cts.close();
            trace.log(`setReady(${this.uri})`);
        }
    }

    protected setError(error: any) {
        if (!this._ready) {
            this._ready = true;
            this._error = error;
            this._deferred.reject(error);
            this._cts.close();
            trace.log(`setError(${this.uri}) -> ${error.stack}`);
        }
    }

    private setCanceled(error: any) {
        if (!this._ready) {
            this._ready = true;
            this._error = error;
            this._deferred.reject(error);
            trace.log(`setCanceled(${this.uri}) -> ${error.stack}`);
        }
    }
}
