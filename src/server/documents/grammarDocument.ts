import { TextDocument, Position } from "vscode-languageserver";
import { DocumentBase } from "./documentBase";
import { DocumentManager } from "./documentManager";
import { SpecDocument } from "./specDocument";
import { fetchString } from "../fetch";
import { TraceSwitch } from "../utils";
import * as utils from "../utils";
import * as fs from "fs";

const trace = new TraceSwitch(`ecmarkup-vscode-grammardocument`, /*enabled*/ false);

export class GrammarDocument extends DocumentBase {
    public readonly namespace: string;

    private _textDocument: TextDocument;
    private _specDocument: SpecDocument;

    constructor(documents: DocumentManager, uri: string, namespace: string, textDocument?: TextDocument, specDocument?: SpecDocument) {
        super(documents, uri);
        this.namespace = namespace;
        if (specDocument) {
            this.continueWithSpecDocument(textDocument, specDocument);
        }
        else if (textDocument) {
            this.continueWithTextDocument(textDocument);
        }
        else {
            this.fetch();
        }
    }

    public get textDocument() { return this._textDocument; }
    public get specDocument() { return this._specDocument; }

    private fetch() {
        trace.log(`fetch(${this.uri}, ${this.namespace})`);
        try {
            let file: string;
            if (utils.isFileUrl(this.uri)) {
                file = utils.toLocalPath(this.uri);
            }
            else if (utils.isUrl(this.uri)) {
                fetchString(this.uri, this.cancellationToken).then(content => this.continueWithTextContent(content));
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
        trace.log(`continueWithTextContent(${this.uri}, ${this.namespace})`);
        try {
            const textDocument = TextDocument.create(this.uri, "grammarkdown", 0, content);
            this.continueWithTextDocument(textDocument);
        }
        catch (e) {
            this.setError(e);
        }
    }

    private continueWithTextDocument(textDocument: TextDocument) {
        trace.log(`continueWithTextDocument(${this.uri}, ${this.namespace})`);
        try {
            this._textDocument = textDocument;
            this.setUri(textDocument.uri);
            this.setReady();
        }
        catch (e) {
            this.setError(e);
        }
    }

    private continueWithSpecDocument(textDocument: TextDocument, specDocument: SpecDocument) {
        trace.log(`continueWithSpecDocument(${this.uri}, ${this.namespace}, ${specDocument.uri})`);
        try {
            this._textDocument = textDocument;
            this._specDocument = specDocument;
            this.setReady();
        }
        catch (e) {
            this.setError(e);
        }
    }
}