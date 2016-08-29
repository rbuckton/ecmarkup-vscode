import { TextDocument } from "vscode-languageserver";
import { TextDocumentWithSourceMap } from "./textDocument";
import { extractContent } from "./html";
import * as yaml from "js-yaml";
import { LocationInfo } from "parse5";
import Tokenizer = require("parse5/lib/tokenizer");
import ParserFeedbackSimulator = require("parse5/lib/sax/parser_feedback_simulator");
import { TAG_NAMES, SPECIAL_ELEMENTS, NAMESPACES as NS } from "parse5/lib/common/html";

declare module "js-yaml" {
    interface LoadOptions {
        onWarning?: (message: string) => void;
    }
}

export interface ParseSpecResult {
    links: Link[];
    metadata: any;
    metadataDocument: TextDocumentWithSourceMap | undefined;
    grammarDocument: TextDocumentWithSourceMap | undefined;
}

export interface Link {
    rel: string;
    href: string;
    location: LocationInfo;
}

export function parseSpec(textDocument: TextDocument): ParseSpecResult {
    const tokenizer = new Tokenizer({ locationInfo: true });
    const parserFeedbackSimulator = new ParserFeedbackSimulator(tokenizer);
    tokenizer.write(textDocument.getText(), true);

    const links: Link[] = [];

    let metadata: any;
    let metadataDocument: TextDocumentWithSourceMap;
    let metadataGrammar: string;
    let metadataStartOffset = -1;
    let metadataEndOffset = -1;

    const grammarFragments: TextDocumentWithSourceMap[] = [];
    let grammarStrict: boolean;
    let grammarStartOffset = -1;
    let grammarEndOffset = -1;

    let mode = htmlMode;
    let token: Tokenizer.Token;
    do {
        token = parserFeedbackSimulator.getNextToken();
        mode(token, parserFeedbackSimulator.currentNamespace);
    }
    while (token.type !== Tokenizer.EOF_TOKEN);

    const grammarDocument = TextDocumentWithSourceMap.concat(textDocument.uri, "grammarkdown", textDocument.version, grammarFragments);

    return { links, metadata, metadataDocument, grammarDocument };

    function htmlMode(token: Tokenizer.Token, ns: string) {
        switch (token.type) {
            case Tokenizer.START_TAG_TOKEN:
                if (ns === NS.HTML) {
                    switch (token.tagName) {
                        case "pre":
                            if (Tokenizer.getTokenAttr(token, "class") === "metadata" && !metadata) {
                                metadataStartOffset = token.location.endOffset;
                                mode = metadataMode;
                            }
                            break;

                        case "emu-grammar":
                            grammarStrict = isStrictModeGrammar(token);
                            grammarStartOffset = token.location.endOffset;
                            mode = grammarMode;
                            break;

                        case "link":
                            const rel = Tokenizer.getTokenAttr(token, "rel");
                            const href = Tokenizer.getTokenAttr(token, "href");
                            if ((rel === "spec" || rel === "grammar") && href) {
                                links.push({ rel, href, location: token.location });
                            }
                            break;
                    }
                }
                break;
        }
    }

    function metadataMode(token: Tokenizer.Token, ns: string) {
        switch (token.type) {
            case Tokenizer.START_TAG_TOKEN:
            case Tokenizer.END_TAG_TOKEN:
                metadataEndOffset = token.location.startOffset;
                break;

            case Tokenizer.EOF_TOKEN:
            case Tokenizer.HIBERNATION_TOKEN:
                break;

            default:
                metadataEndOffset = token.location.startOffset;
                return;
        }

        try {
            metadataDocument = extractContent(textDocument, metadataStartOffset, metadataEndOffset);
            metadata = yaml.safeLoad(metadataDocument.getText(), {
                filename: metadataDocument.uri,
                onWarning: message => {
                    // TODO
                    console.warn(message);
                }
            });
            metadataGrammar = metadata.grammar;
        }
        catch (e) {
            metadata = {};
        }

        metadataStartOffset = -1;
        metadataEndOffset = -1;
        mode = htmlMode;
        mode(token, ns);
    }

    function grammarMode(token: Tokenizer.Token, ns: string) {
        switch (token.type) {
            case Tokenizer.START_TAG_TOKEN:
            case Tokenizer.END_TAG_TOKEN:
                grammarEndOffset = token.location.startOffset;
                if (shouldExitGrammarMode(token.tagName, ns)) break; // exit grammar
                return; // consume tag

            case Tokenizer.HIBERNATION_TOKEN:
            case Tokenizer.EOF_TOKEN:
                break; // exit grammar

            default:
                grammarEndOffset = token.location.startOffset;
                return; // consume tag;
        }

        // only parse/check strict grammars.
        if (grammarStrict) {
            grammarFragments.push(extractContent(textDocument, grammarStartOffset, grammarEndOffset));
        }

        grammarStartOffset = -1;
        grammarEndOffset = -1;
        mode = htmlMode;
        mode(token, ns);
    }

    function isStrictModeGrammar(token: Tokenizer.StartTagToken) {
        return metadataGrammar === "strict"
            ? Tokenizer.getTokenAttr(token, "relaxed") === null
            : Tokenizer.getTokenAttr(token, "strict") !== null;
    }

    function shouldExitGrammarMode(tagName: string, ns: string) {
        if (ns !== NS.HTML) return true; // exit grammar in foreign context
        if (/^(in?s?|de?l?)$/i.test(tagName)) return false; // do not exit for ins/del
        if (/^emu-/i.test(tagName)) return true; // exit grammar on any emu- node
        return SPECIAL_ELEMENTS[NS.HTML][tagName] === true; // exit for special elements
    }
}

