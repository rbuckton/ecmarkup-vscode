import { Position, Range } from "vscode-languageserver";
import { TextDocumentWithSourceMap } from "./textDocument";
import { SortedList } from "./utils";
import Tokenizer = require("parse5/lib/tokenizer");

export const enum EmuKind {
    EmuSpec,
    EmuMetadata,
    EmuIntro,
    EmuClause,
    EmuAnnex,
    EmuAlg,
    EmuVar,
    EmuExtern,
    EmuEqn,
    EmuNote,
    EmuXref,
    EmuFigure,
    EmuTable,
    EmuExample,
    EmuBiblio,
    EmuGrammar,
    EmuProduction,
    EmuParam,
    EmuRhs,
    EmuConstraint,
    EmuNt,
    EmuArg,
    EmuT,
    EmuGmod,
    EmuGann,
    EmuGprose,
    EmuProdRef,
    EmuImport,
    TextContent,
    HtmlTag,
    HtmlLink
}

export type EmuNode =
    EmuSpec |
    EmuMetadata |
    EmuIntro |
    EmuClause |
    EmuAnnex |
    EmuAlg |
    EmuVar |
    EmuExtern |
    EmuEqn |
    EmuNote |
    EmuXref |
    EmuFigure |
    EmuTable |
    EmuExample |
    EmuBiblio |
    EmuGrammar |
    EmuProduction |
    EmuParam |
    EmuRhs |
    EmuConstraint |
    EmuNt |
    EmuArg |
    EmuT |
    EmuGmod |
    EmuGann |
    EmuGprose |
    EmuProdRef |
    EmuImport |
    TextContent |
    HtmlLink;

type EmuClauseLike =
    EmuSpec |
    EmuIntro |
    EmuClause |
    EmuAnnex;

type EmuGrammarSymbol =
    EmuNt |
    EmuT |
    EmuGmod |
    EmuGann |
    EmuGprose;

export interface EmuNodeBase {
    kind: EmuKind;
    namespace?: string;
    parent?: EmuNode;
    children?: EmuNode[];
    range?: Range;
    contentRange?: Range;
    startTag?: Tokenizer.StartTagToken;
    endTag?: Tokenizer.EndTagToken;
}

export interface EmuSpec extends EmuNodeBase {
    kind: EmuKind.EmuSpec;
    metadata: any;
    links: HtmlLink[];
    imports: EmuImport[];
    grammars: EmuGrammar[];
    namespaces: string[];
    sortedNodes: SortedList<EmuNode, Position>;
}

export interface EmuMetadata extends EmuNodeBase {
    kind: EmuKind.EmuMetadata;
    metadata: Metadata;
    document: TextDocumentWithSourceMap;
}

export interface Metadata {
    status: string;
    version: string;
    title: string;
    shortname: string;
    stage: string;
    copyright: boolean;
    date: string | Date;
    location: string;
    contributors: string;
    toc: boolean;
    oldToc: boolean;
    verbose: boolean;
    grammar: string;
    dependencies: string | string[];
}

export interface EmuIntro extends EmuNodeBase {
    kind: EmuKind.EmuIntro;
    id: string;
    aoid: string;
}

export interface EmuClause extends EmuNodeBase {
    kind: EmuKind.EmuClause;
    id: string;
    aoid: string;
}

export interface EmuAnnex extends EmuNodeBase {
    kind: EmuKind.EmuAnnex;
    id: string;
    aoid: string;
}

export interface EmuAlg extends EmuNodeBase {
    kind: EmuKind.EmuAlg;
    id: string;
    aoid: string;
}

export interface EmuVar extends EmuNodeBase {
    kind: EmuKind.EmuVar;
    text: string;
}

export interface EmuExtern extends EmuNodeBase {
    kind: EmuKind.EmuExtern;
    aoid: string;
}

export interface EmuEqn extends EmuNodeBase {
    kind: EmuKind.EmuEqn;
    id: string;
    aoid: string;
}

export interface EmuNote extends EmuNodeBase {
    kind: EmuKind.EmuNote;
}

export interface EmuXref extends EmuNodeBase {
    kind: EmuKind.EmuXref;
    href: string;
    aoid: string;
}

export interface EmuFigure extends EmuNodeBase {
    kind: EmuKind.EmuFigure;
    id: string;
}

export interface EmuTable extends EmuNodeBase {
    kind: EmuKind.EmuTable;
    id: string;
}

export interface EmuExample extends EmuNodeBase {
    kind: EmuKind.EmuExample;
    id: string;
}

export interface EmuBiblio extends EmuNodeBase {
    kind: EmuKind.EmuBiblio;
    href: string;
}

export interface EmuGrammar extends EmuNodeBase {
    kind: EmuKind.EmuGrammar;
    document?: TextDocumentWithSourceMap;
    mode?: "strict" | "relaxed";
}

export interface EmuProduction extends EmuNodeBase {
    kind: EmuKind.EmuProduction;
    name: string;
    params?: EmuParam[];
}

export interface EmuParam extends EmuNodeBase {
    kind: EmuKind.EmuParam;
    name: string;
}

export interface EmuRhs extends EmuNodeBase {
    kind: EmuKind.EmuRhs;
    constraints?: EmuConstraint[];
    a: string;
}

export interface EmuConstraint extends EmuNodeBase {
    kind: EmuKind.EmuConstraint;
    text: string;
}

export interface EmuNt extends EmuNodeBase {
    kind: EmuKind.EmuNt;
    text?: string;
    args?: EmuArg[];
    oneOf: boolean;
}

export interface EmuArg extends EmuNodeBase {
    kind: EmuKind.EmuArg;
    text: string;
}

export interface EmuT extends EmuNodeBase {
    kind: EmuKind.EmuT;
    text: string;
}

export interface EmuGmod extends EmuNodeBase {
    kind: EmuKind.EmuGmod;
    text: string;
}

export interface EmuGann extends EmuNodeBase {
    kind: EmuKind.EmuGann;
    text: string;
}

export interface EmuGprose extends EmuNodeBase {
    kind: EmuKind.EmuGprose;
    text: string;
}

export interface EmuProdRef extends EmuNodeBase {
    kind: EmuKind.EmuProdRef;
    name: string;
    a: string;
}

export interface EmuImport extends EmuNodeBase {
    kind: EmuKind.EmuImport;
    href: string;
}

export interface TextContent extends EmuNodeBase {
    kind: EmuKind.TextContent;
    text: string;
}

export interface HtmlLink extends EmuNodeBase {
    kind: EmuKind.HtmlLink;
    rel: string;
    href: string;
}