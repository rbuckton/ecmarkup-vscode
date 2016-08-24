import { TextDocument, TextDocumentIdentifier, Position, Location, Range } from "vscode-languageserver";
import { SourceMap, SourceRange, SourcePosition } from "./sourceMap";
import { TextDocumentWithSourceMap } from "./textDocument";
import { EOL } from "os";

const newLinePattern = /\r?\n/g;

export interface StringWriterOptions {
    sourceMap?: SourceMap;
    source?: string;
}

export class StringWriter {
    private _text = "";
    private _line = 0;
    private _character = 0;
    private _newLine: boolean;
    private _sourceMap: SourceMap;
    private _source: string;

    constructor(options?: StringWriterOptions) {
        this._sourceMap = options && options.sourceMap;
        this._source = options && options.source;
    }

    public get size() { return this._text.length; }
    public get line() { return this._line; }
    public get character() { return this._character; }

    public getPosition() { return { line: this.line, character: this.character }; }

    public writeDocument(textDocument: TextDocument) {
        this.writeln();

        if (this._sourceMap) {
            if (TextDocumentWithSourceMap.is(textDocument)) {
                textDocument.sourceMap.forEachMapping(({ generatedPosition, sourcePosition }) => {
                    const newGeneratedPosition = Position.create(
                        generatedPosition.line + this.line,
                        generatedPosition.character + (generatedPosition.line === 0 ? this.character : 0));
                    this._sourceMap.addMapping(newGeneratedPosition, sourcePosition);
                });
            }
            else {
                for (let i = 0; i < textDocument.lineCount; i++) {
                    const newGeneratedPosition = Position.create(i + this.line, i === 0 ? this.character : 0);
                    const newSourcePosition = SourcePosition.create(textDocument.uri, Position.create(i, 0));
                    this._sourceMap.addMapping(newGeneratedPosition, newSourcePosition);
                }
            }
        }

        this.write(textDocument.getText());
    }

    public write(text: string, where?: SourceRange | Range | SourcePosition | Position) {
        if (text) {
            if (where) this.addStartMapping(where);

            let match: RegExpMatchArray;
            let lastIndex = newLinePattern.lastIndex = 0;
            while (match = newLinePattern.exec(text)) {
                this._line++;
                this._character = 0;
                lastIndex = match.index + match[0].length;
            }

            this._character += text.length - lastIndex;
            this._text += text;

            if (where) this.addEndMapping(where);
        }

        return this;
    }

    public writeln() {
        if ((this._line > 0 || this._character > 0)) {
            this._text += EOL;
            this._line++;
            this._character = 0;

        }
        return this;
    }

    public toString() {
        return this._text;
    }

    public clear() {
        this._text = "";
        this._line = 0;
        this._character = 0;
        this._newLine = false;
    }

    private addStartMapping(where: SourceRange | Range | SourcePosition | Position) {
        if (SourcePosition.is(where)) {
            this.addMapping(where);
        }
        else if (Position.is(where)) {
            this.addMapping(SourcePosition.create(this._source, where));
        }
        else if (SourceRange.is(where)) {
            this.addMapping(SourcePosition.create(where.uri, where.range.start));
        }
        else if (Range.is(where)) {
            this.addMapping(SourcePosition.create(this._source, where.start));
        }
    }

    private addEndMapping(where: SourceRange | Range | SourcePosition | Position) {
        if (SourceRange.is(where)) {
            this.addMapping(SourcePosition.create(where.uri, where.range.end));
        }
        else if (Range.is(where)) {
            this.addMapping(SourcePosition.create(this._source, where.end));
        }
    }

    private addMapping(sourcePosition: SourcePosition) {
        if (this._sourceMap) {
            this._sourceMap.addMapping(this.getPosition(), sourcePosition);
        }
    }
}