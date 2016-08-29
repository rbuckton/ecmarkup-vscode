declare module "parse5/lib/tokenizer" {
    import { LocationInfo, StartTagLocationInfo } from "parse5";

    type StartTagToken = Tokenizer.StartTagToken;
    type EndTagToken = Tokenizer.EndTagToken;
    type CharacterToken = Tokenizer.CharacterToken;
    type AttrToken = Tokenizer.Attr;
    type Token = Tokenizer.Token;
    type MODE = Tokenizer.MODE;

    class Tokenizer {
        readonly MODE: typeof Tokenizer.MODE;

        allowCDATA: boolean;
        active: boolean;
        state: MODE;
        returnState: MODE | "";
        currentCharacterToken: CharacterToken | null;
        currentToken: Token | null;
        currentAttr: AttrToken | null;

        constructor(options?: { locationInfo?: boolean });

        static getTokenAttr(token: StartTagToken | EndTagToken, attrName: string): string | null;

        getNextToken(): Token;
        write(chunk: string, isLastChunk: boolean): void;
        insertHtmlAtCurrentPos(chunk: string): void;
        isTempBufferEqualToScriptString(): boolean;
    }

    namespace Tokenizer {
        const CHARACTER_TOKEN: "CHARACTER_TOKEN";
        const NULL_CHARACTER_TOKEN: "NULL_CHARACTER_TOKEN";
        const WHITESPACE_CHARACTER_TOKEN: "WHITESPACE_CHARACTER_TOKEN";
        const START_TAG_TOKEN: "START_TAG_TOKEN";
        const END_TAG_TOKEN: "END_TAG_TOKEN";
        const COMMENT_TOKEN: "COMMENT_TOKEN";
        const DOCTYPE_TOKEN: "DOCTYPE_TOKEN";
        const EOF_TOKEN: "EOF_TOKEN";
        const HIBERNATION_TOKEN: "HIBERNATION_TOKEN";

        interface StartTagToken {
            type: typeof START_TAG_TOKEN;
            tagName: string;
            selfClosing: boolean;
            attrs: Attr[];
            location?: StartTagLocationInfo;
        }

        interface EndTagToken {
            type: typeof END_TAG_TOKEN;
            tagName: string;
            attrs: Attr[];
            location?: LocationInfo | StartTagLocationInfo;
        }

        interface Attr {
            name: string;
            value: string;
            location?: LocationInfo;
        }

        interface CommentToken {
            type: typeof COMMENT_TOKEN;
            data: string;
            location?: LocationInfo;
        }

        interface DoctypeToken {
            type: typeof DOCTYPE_TOKEN;
            name: string;
            forceQuirks: boolean;
            publicId: string | null;
            systemId: string | null;
            location?: LocationInfo;
        }

        interface CharacterToken {
            type: typeof WHITESPACE_CHARACTER_TOKEN | typeof NULL_CHARACTER_TOKEN | typeof CHARACTER_TOKEN;
            chars: string;
            location?: LocationInfo;
        }

        interface EOFToken {
            type: typeof EOF_TOKEN;
        }

        interface HibernationToken {
            type: typeof HIBERNATION_TOKEN;
        }

        type Token = StartTagToken | EndTagToken | CommentToken | DoctypeToken | CharacterToken | EOFToken | HibernationToken;

        namespace MODE {
            const DATA: "DATA_STATE";
            const RCDATA: "RCDATA_STATE";
            const RAWTEXT: "RAWTEXT_STATE";
            const SCRIPT_DATA: "SCRIPT_DATA_STATE";
            const PLAINTEXT: "PLAINTEXT_STATE";
        }

        type MODE = typeof MODE.DATA | typeof MODE.RCDATA | typeof MODE.RAWTEXT | typeof MODE.SCRIPT_DATA | typeof MODE.PLAINTEXT;
    }

    export = Tokenizer;
}

declare module "parse5/lib/sax/parser_feedback_simulator" {
    import Tokenizer = require("parse5/lib/tokenizer");
    import Token = Tokenizer.Token;

    class ParserFeedbackSimulator {
        inForeignContext: boolean;
        currentNamespace: string;
        constructor(tokenizer: Tokenizer);
        getNextToken(): Token;
    }

    export = ParserFeedbackSimulator;
}

declare module "parse5/lib/common/html" {
    const NAMESPACES: {
        HTML: string;
        [name: string]: string;
    };

    const ATTRS: {
        [name: string]: string;
    };

    const TAG_NAMES: {
        [name: string]: string;
    };

    const SPECIAL_ELEMENTS: {
        [namespace: string]: {
            [tagName: string]: boolean;
        }
    };
}