import { TextDocument, TextDocumentIdentifier, Range, Location, Position } from "vscode-languageserver";
import { RawSourceMap, RawIndexMap, SourceMapGenerator, SourceMapConsumer } from "source-map";
import { StringWriter } from "./writer";
import { SourceMap, SourceRange, SourcePosition, Bias } from "./sourceMap";

export interface TextDocumentWithSourceMap extends TextDocument {
    sourceMap: SourceMap;
}

export namespace TextDocumentWithSourceMap {
    export function create(uri: string, languageId: string, version: number, content: string, sourceMap: SourceMap): TextDocumentWithSourceMap {
        const textDocument = TextDocument.create(uri, languageId, version, content) as TextDocumentWithSourceMap;
        textDocument.sourceMap = sourceMap;
        return textDocument;
    }

    export function concat(uri: string, languageId: string, version: number, fragments: TextDocument[]) {
        const sourceMap = new SourceMap({ file: uri });
        const writer = new StringWriter({ sourceMap, source: uri });
        for (const fragment of fragments) {
            writer.writeDocument(fragment);
        }
        return create(uri, languageId, version, writer.toString(), sourceMap);
    }

    export function is(value: any): value is TextDocumentWithSourceMap {
        return <boolean>TextDocument.is(value)
            && typeof value.sourceMap === "object";
    }

    export function sourcePositionFor(textDocument: TextDocument, generatedPosition: Position, bias = Bias.AdjustedGreatestLowerBound) {
        if (TextDocumentWithSourceMap.is(textDocument)) {
            return textDocument.sourceMap.sourcePositionFor(generatedPosition, bias);
        }
        return SourcePosition.create(textDocument.uri, generatedPosition);
    }

    export function sourceRangeFor(textDocument: TextDocument, generatedRange: Range, bias = Bias.AdjustedGreatestLowerBound) {
        if (TextDocumentWithSourceMap.is(textDocument)) {
            return textDocument.sourceMap.sourceRangeFor(generatedRange, bias);
        }
        return SourceRange.create(textDocument.uri, generatedRange);
    }

    export function generatedPositionFor(textDocument: TextDocument, originalPosition: SourcePosition, bias = Bias.AdjustedGreatestLowerBound) {
        if (TextDocumentWithSourceMap.is(textDocument)) {
            return textDocument.sourceMap.generatedPositionFor(originalPosition, bias);
        }
        return originalPosition.position;
    }

    export function generatedRangeFor(textDocument: TextDocument, sourceRange: SourceRange, bias = Bias.AdjustedGreatestLowerBound) {
        if (TextDocumentWithSourceMap.is(textDocument)) {
            return textDocument.sourceMap.generatedRangeFor(sourceRange, bias);
        }
        return sourceRange.range;
    }
}