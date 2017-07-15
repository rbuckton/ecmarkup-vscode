import { TextDocument } from "vscode-languageserver";
import { CancellationTokenSource } from "prex";
import { DocumentBase } from "./documentBase";
import { SpecDocument } from "./specDocument";
import { DocumentManager } from "./documentManager";
import { fetchString } from "../fetch";
import * as utils from "../utils";
import * as fs from "fs";

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

    private async continueWithSpecDocument(specDocument: SpecDocument) {
        try {
            this._textDocument = specDocument.grammarDocument;
            this._specDocument = specDocument;
            if (!specDocument.ready) {
                await specDocument.waitForReady();
            }
            this.setReady();
        }
        catch (e) {
            this.setError(e);
        }
    }
}
