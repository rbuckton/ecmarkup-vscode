import { IConnection } from "vscode-languageserver";
import { SpecDocuments } from "./specDocuments";
import { GrammarDocuments } from "./grammarDocuments";

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
