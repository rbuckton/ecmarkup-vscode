import { TextDocument, Range, Position, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocumentWithSourceMap } from "./textDocument";
import { extractContent } from "./html";
import { TAG_NAMES, SPECIAL_ELEMENTS, NAMESPACES as NS } from "parse5/lib/common/html";
import { LocationInfo } from "parse5";
import { EmuKind, EmuNode, EmuSpec, EmuGrammar, HtmlLink, EmuImport, EmuMetadata } from "./nodes";
import { Stack, SortedList, ArraySet, TraceSwitch, TraceLevel } from "./utils";
import { Uri } from "./uri";
import ParserFeedbackSimulator = require("parse5/lib/sax/parser_feedback_simulator");
import Tokenizer = require("parse5/lib/tokenizer");
import * as yaml from "js-yaml";
import * as utils from "./utils";
import * as fs from "fs";

declare module "js-yaml" {
    interface LoadOptions {
        onWarning?: (message: string) => void;
    }
}

const trace = new TraceSwitch("ecmarkup-vscode-parser");

export function parseSpec(textDocument: TextDocument): EmuSpec {
    const parser = new Parser();
    return parser.parse(textDocument);
}

class Parser {
    public tagStack = new Stack<Tokenizer.StartTagToken>();
    public childrenStack = new Stack<EmuNode[]>();

    private _tokenizer: Tokenizer;
    private _parserFeedbackSimulator: ParserFeedbackSimulator;
    private _htmlMode: HtmlMode;
    private _grammarMode: GrammarMode;
    private _metadataMode: MetadataMode;
    private _mode: ParserMode;
    private _textDocument: TextDocument;
    private _metadataId: number;
    private _grammarId: number;
    private _metadata: any;
    private _grammars: EmuGrammar[];
    private _links: HtmlLink[];
    private _imports: EmuImport[];

    constructor() {
        this._htmlMode = new HtmlMode(this);
        this._grammarMode = new GrammarMode(this);
        this._metadataMode = new MetadataMode(this);
    }

    get namespace() { return this._parserFeedbackSimulator ? this._parserFeedbackSimulator.currentNamespace : NS.HTML; }
    get mode() { return this._mode; }

    parse(textDocument: TextDocument): EmuSpec {
        this.setHtmlMode();
        this.tagStack.clear();
        this.childrenStack.clear();
        this.childrenStack.push([]);
        this._metadataId = 0;
        this._grammarId = 0;
        this._grammars = [];
        this._links = [];
        this._imports = [];
        this._textDocument = textDocument;
        this._tokenizer = new Tokenizer({ locationInfo: true });
        this._parserFeedbackSimulator = new ParserFeedbackSimulator(this._tokenizer);
        this._tokenizer.write(textDocument.getText(), /*isLastChunk*/ true);

        let token: Tokenizer.Token;
        do {
            token = this._parserFeedbackSimulator.getNextToken();
            switch (token.type) {
                case Tokenizer.CHARACTER_TOKEN:
                    this.mode.onCharacter(token);
                    break;

                case Tokenizer.NULL_CHARACTER_TOKEN:
                    this.mode.onNullCharacter(token);
                    break;

                case Tokenizer.WHITESPACE_CHARACTER_TOKEN:
                    this.mode.onWhitespaceCharacter(token);
                    break;

                case Tokenizer.COMMENT_TOKEN:
                    this.mode.onComment(token);
                    break;

                case Tokenizer.DOCTYPE_TOKEN:
                    this.mode.onDoctype(token);
                    break;

                case Tokenizer.START_TAG_TOKEN:
                    this.mode.onStartTag(token);
                    break;

                case Tokenizer.END_TAG_TOKEN:
                    this.mode.onEndTag(token);
                    break;

                case Tokenizer.EOF_TOKEN:
                    this.mode.onEOF(token);
                    break;
            }
        }
        while (token.type !== Tokenizer.EOF_TOKEN);

        const namespaces = new Set<string>();
        const sortedNodes = new SortedList<EmuNode, Position>(x => x.range.start, (x, y) => utils.comparePositions(x, y));

        const spec: EmuSpec = {
            kind: EmuKind.EmuSpec,
            children: this.childrenStack.pop(),
            metadata: this._metadata,
            links: this._links,
            imports: this._imports,
            grammars: this.getStrictGrammars(),
            namespace: this._metadata && this._metadata.location || "",
            namespaces: [],
            sortedNodes,
            range: Range.create(textDocument.positionAt(0), textDocument.positionAt(textDocument.getText().length))
        };

        // set up parent pointers and namespaces
        visit(spec, /*parent*/ undefined);
        return spec;

        function visit(node: EmuNode, parent: EmuNode) {
            sortedNodes.add(node);
            node.parent = parent;
            if (node.namespace === undefined || node.namespace === null) {
                node.namespace = parent.namespace;
            }
            else if (!namespaces.has(node.namespace)) {
                spec.namespaces.push(node.namespace);
                namespaces.add(node.namespace);
            }
            if (node.children) {
                for (const child of node.children) {
                    visit(child, node);
                }
            }
        }
    }

    setHtmlMode() {
        this._mode = this._htmlMode;
    }

    setMetadataMode() {
        this._mode = this._metadataMode;
    }

    setGrammarMode() {
        this._mode = this._grammarMode;
    }

    isEmuTag(tagName: string) {
        switch (tagName) {
            case "emu-intro":
            case "emu-clause":
            case "emu-annex":
            case "emu-alg":
            case "emu-eqn":
            case "emu-note":
            case "emu-xref":
            case "emu-figure":
            case "emu-table":
            case "emu-example":
            case "emu-biblio":
            case "emu-grammar":
            case "emu-production":
            case "emu-rhs":
            case "emu-nt":
            case "emu-t":
            case "emu-gmod":
            case "emu-gann":
            case "emu-gprose":
            case "emu-prodref":
            case "emu-import":
                return true;
        }
        return false;
    }

    parseNode(startTag: Tokenizer.StartTagToken, endToken?: Tokenizer.StartTagToken | Tokenizer.EndTagToken | Tokenizer.EOFToken) {
        const endTag = endToken && endToken.type === Tokenizer.END_TAG_TOKEN ? endToken : undefined;
        const end = endTag ? this.endPositionOf(endTag) : endToken ? this.startPositionOf(endToken) : this.endPositionOf(startTag);
        const range = Range.create(this.startPositionOf(startTag), end);
        const contentRange = endToken ? Range.create(this.endPositionOf(startTag), this.startPositionOf(endToken)) : undefined;
        const children = this.childrenStack.pop();
        const node = this.createNode(startTag, contentRange, children);
        node.startTag = startTag;
        node.endTag = endTag;
        node.range = range;
        node.contentRange = contentRange;
        node.children = children;
        this.childrenStack.peek().push(node);
    }

    private startPositionOf(token: Tokenizer.Token) {
        switch (token.type) {
            case Tokenizer.CHARACTER_TOKEN:
            case Tokenizer.WHITESPACE_CHARACTER_TOKEN:
            case Tokenizer.NULL_CHARACTER_TOKEN:
            case Tokenizer.COMMENT_TOKEN:
            case Tokenizer.DOCTYPE_TOKEN:
            case Tokenizer.START_TAG_TOKEN:
            case Tokenizer.END_TAG_TOKEN:
                return this._textDocument.positionAt(token.location.startOffset);
            default:
                return this._textDocument.positionAt(0);
        }
    }

    private endPositionOf(token: Tokenizer.Token) {
        switch (token.type) {
            case Tokenizer.CHARACTER_TOKEN:
            case Tokenizer.WHITESPACE_CHARACTER_TOKEN:
            case Tokenizer.NULL_CHARACTER_TOKEN:
            case Tokenizer.COMMENT_TOKEN:
            case Tokenizer.DOCTYPE_TOKEN:
            case Tokenizer.START_TAG_TOKEN:
            case Tokenizer.END_TAG_TOKEN:
                return this._textDocument.positionAt(token.location.endOffset);
            default:
                return this._textDocument.positionAt(this._textDocument.getText().length);
        }
    }

    private createNode(startTag: Tokenizer.StartTagToken, contentRange: Range, children: EmuNode[]): EmuNode {
        switch (startTag.tagName) {
            case "emu-intro": return { kind: EmuKind.EmuIntro, id: attr("id"), aoid: attr("aoid"), namespace: attr("namespace") };
            case "emu-clause": return { kind: EmuKind.EmuClause, id: attr("id"), aoid: attr("aoid"), namespace: attr("namespace") };
            case "emu-annex": return { kind: EmuKind.EmuAnnex, id: attr("id"), aoid: attr("aoid"), namespace: attr("namespace") };
            case "emu-alg": return { kind: EmuKind.EmuAlg, id: attr("id"), aoid: attr("aoid") };
            case "emu-eqn": return { kind: EmuKind.EmuEqn, id: attr("id"), aoid: attr("aoid") };
            case "emu-note": return { kind: EmuKind.EmuNote };
            case "emu-xref": return { kind: EmuKind.EmuXref, aoid: attr("aoid"), href: attr("href") };
            case "emu-figure": return { kind: EmuKind.EmuFigure, id: attr("id") };
            case "emu-table": return { kind: EmuKind.EmuTable, id: attr("id") };
            case "emu-example": return { kind: EmuKind.EmuExample, id: attr("id") };
            case "emu-biblio": return { kind: EmuKind.EmuBiblio, href: attr("href") };
            case "emu-production": return { kind: EmuKind.EmuProduction, name: attr("name") };
            case "emu-rhs": return { kind: EmuKind.EmuRhs, a: attr("a") };
            case "emu-nt": return { kind: EmuKind.EmuNt, text: this.getText(contentRange), oneOf: has("oneof") };
            case "emu-t": return { kind: EmuKind.EmuT, text: this.getText(contentRange) };
            case "emu-gmod": return { kind: EmuKind.EmuGmod, text: this.getText(contentRange) };
            case "emu-gann": return { kind: EmuKind.EmuGann, text: this.getText(contentRange) };
            case "emu-gprose": return { kind: EmuKind.EmuGprose, text: this.getText(contentRange) };
            case "emu-prodref": return { kind: EmuKind.EmuProdRef, name: attr("name"), a: attr("a") };
            case "emu-import": return this.createImport(startTag);
            case "emu-grammar": return this.createGrammarNode(startTag, contentRange);
            case "link": return this.createLink(startTag);
            case "pre": return this.createMetadataNode(contentRange);
            default: throw new Error("Not supported.");
        }

        function attr(name: string) { return Tokenizer.getTokenAttr(startTag, name); }
        function has(name: string) { return attr(name) !== null; }
    }

    private createMetadataNode(contentRange: Range): EmuMetadata {
        const uri = Uri.parse(this._textDocument.uri);
        const fragmentUri = uri.with({ fragment: `yaml-${this._metadataId++}` });
        const document = extractContent(fragmentUri.toString(), "yaml", this._textDocument.version, this._textDocument, contentRange.start, contentRange.end);
        const metadata = yaml.safeLoad(document.getText(), {
            onWarning: message => { console.warn(message); }
        });
        this._metadata = Object.assign({}, this._metadata, metadata);
        return { kind: EmuKind.EmuMetadata, metadata, document };
    }

    private createLink(startTag: Tokenizer.StartTagToken): HtmlLink {
        const node: HtmlLink = { kind: EmuKind.HtmlLink, rel: Tokenizer.getTokenAttr(startTag, "rel"), href: Tokenizer.getTokenAttr(startTag, "href") };
        this._links.push(node);
        return node;
    }

    private createImport(startTag: Tokenizer.StartTagToken): EmuImport {
        const node: EmuImport = { kind: EmuKind.EmuImport, href: Tokenizer.getTokenAttr(startTag, "href") };
        this._imports.push(node);
        return node;
    }

    private createGrammarNode(startTag: Tokenizer.StartTagToken, contentRange: Range): EmuGrammar {
        const uri = Uri.parse(this._textDocument.uri);
        const fragmentUri = uri.with({ fragment: `grammar-${this._grammarId++}` });
        const document = extractContent(fragmentUri.toString(), "grammarkdown", this._textDocument.version, this._textDocument, contentRange.start, contentRange.end);
        const mode: "strict" | "relaxed" =
            Tokenizer.getTokenAttr(startTag, "strict") !== null ? "strict" :
            Tokenizer.getTokenAttr(startTag, "relaxed") !== null ? "relaxed" :
            undefined;
        const node: EmuGrammar = { kind: EmuKind.EmuGrammar, document, mode };
        this._grammars.push(node);
        return node;
    }

    private getText(range: Range) {
        return range ? this._textDocument.getText().slice(this._textDocument.offsetAt(range.start), this._textDocument.offsetAt(range.end)) : "";
    }

    private getStrictGrammars() {
        return this._grammars.filter(grammar =>
            this._metadata && this._metadata.grammar === "strict"
                ? grammar.mode !== "relaxed"
                : grammar.mode === "strict");
    }
}

abstract class ParserMode {
    protected readonly parser: Parser;
    constructor (parser: Parser) { this.parser = parser; }
    onCharacter(token: Tokenizer.CharacterToken): void {}
    onWhitespaceCharacter(token: Tokenizer.CharacterToken): void {}
    onNullCharacter(token: Tokenizer.CharacterToken): void {}
    onComment(token: Tokenizer.CommentToken): void {}
    onDoctype(token: Tokenizer.DoctypeToken): void {}
    onStartTag(token: Tokenizer.StartTagToken): void {}
    onEndTag(token: Tokenizer.EndTagToken): void {}
    onEOF(token: Tokenizer.EOFToken): void {}
}

class HtmlMode extends ParserMode {
    onStartTag(startTag: Tokenizer.StartTagToken) {
        if (this.parser.isEmuTag(startTag.tagName)) {
            this.parser.tagStack.push(startTag);
            this.parser.childrenStack.push([]);
            if (startTag.tagName === "emu-grammar") {
                this.parser.setGrammarMode();
            }
        }
        else if (startTag.tagName === "pre" && Tokenizer.getTokenAttr(startTag, "class") === "metadata") {
            this.parser.tagStack.push(startTag);
            this.parser.childrenStack.push([]);
            this.parser.setMetadataMode();
        }
        else if (startTag.tagName === "link" && /^(spec|grammar)$/.test(Tokenizer.getTokenAttr(startTag, "rel")) && Tokenizer.getTokenAttr(startTag, "href") !== null) {
            this.parser.childrenStack.push([]);
            this.parser.parseNode(startTag);
        }
    }

    onEndTag(endTag: Tokenizer.EndTagToken) {
        if (this.parser.isEmuTag(endTag.tagName)) {
            let startTag: Tokenizer.StartTagToken;
            do {
                this.parser.parseNode(this.parser.tagStack.pop(), endTag);
            }
            while (startTag && startTag.tagName !== endTag.tagName);
        }
    }
}

class MetadataMode extends ParserMode {
    onStartTag(token: Tokenizer.StartTagToken) {
        if (this.shouldExit(token.tagName, this.parser.namespace)) {
            this.parser.setHtmlMode();
            this.parser.mode.onStartTag(token);
        }
    }

    onEndTag(token: Tokenizer.EndTagToken) {
        if (this.parser.tagStack.peek().tagName === token.tagName || this.shouldExit(token.tagName, this.parser.namespace)) {
            this.parser.setHtmlMode();
            this.parser.mode.onEndTag(token);
        }
    }

    onEOF(token: Tokenizer.EOFToken) {
        this.parser.setHtmlMode();
        this.parser.mode.onEOF(token);
    }

    shouldExit(tagName: string, ns: string) {
        if (ns !== NS.HTML) return true; // exit in foreign context
        if (SPECIAL_ELEMENTS[NS.HTML][tagName] === true) return true; // exit for special elements
        return false;
    }
}

class GrammarMode extends ParserMode {
    onStartTag(token: Tokenizer.StartTagToken) {
        if (this.shouldExitTextMode(token.tagName, this.parser.namespace)) {
            this.parser.setHtmlMode();
            this.parser.mode.onStartTag(token);
        }
    }

    onEndTag(token: Tokenizer.EndTagToken) {
        if (this.shouldExitTextMode(token.tagName, this.parser.namespace)) {
            this.parser.setHtmlMode();
            this.parser.mode.onEndTag(token);
        }
    }

    onEOF(token: Tokenizer.EOFToken) {
        this.parser.setHtmlMode();
        this.parser.mode.onEOF(token);
    }

    shouldExitTextMode(tagName: string, ns: string) {
        if (ns !== NS.HTML) return true; // exit in foreign context
        if (/^(in?s?|de?l?)$/i.test(tagName)) return false; // do not exit for ins/del
        if (/^emu-/i.test(tagName)) return true; // exit on any emu- node
        return SPECIAL_ELEMENTS[NS.HTML][tagName] === true; // exit for special elements
    }
}

function getRangeForTagName(token: Tokenizer.StartTagToken | Tokenizer.EndTagToken) {
    const line = token.location.line - 1;
    const start = token.location.col + (token.type === Tokenizer.END_TAG_TOKEN ? 2 : 1);
    const end = start + token.tagName.length;
    return Range.create(line, start, line, end);
}