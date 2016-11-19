import { IConnection } from "vscode-languageserver";
import { SpecDocuments } from "./specDocuments";
import { GrammarDocuments } from "./grammarDocuments";
import { TraceSwitch } from "../utils";

export class DocumentManager {
    private _specDocuments: SpecDocuments;
    private _grammarDocuments: GrammarDocuments;

    constructor() {
        this._specDocuments = new SpecDocuments(this);
        this._specDocuments.on("documentDeleted", document => { this._grammarDocuments.deleteRange(document.grammarFragments); });
        this._grammarDocuments = new GrammarDocuments(this);
    }

    public get specDocuments() { return this._specDocuments; }
    public get grammarDocuments() { return this._grammarDocuments; }
}
