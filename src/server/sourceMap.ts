import { Location, Range, Position } from "vscode-languageserver";
import { StartOfSourceMap, SourceMapConsumer, SourceMapGenerator, MappingItem } from "source-map";
import { Is, binarySearch, ArraySet, SortedList, compareValues } from "./utils";

declare module "source-map" {
    interface SourceMapGenerator {
        toJSON(): RawSourceMap;
    }

    interface RawIndexMap extends StartOfSourceMap {
        version: number;
        sections: { offset: { line: number, column: number }, map: RawSourceMap }[];
    }

    interface SourceMapConsumer {
        sources?: string[];
        sourcesContent?: string[];
        originalPositionFor(generatedPosition: Position & { bias?: number }): MappedPosition;
        generatedPositionFor(originalPosition: MappedPosition & { bias?: number }): Position;
        allGeneratedPositionsFor(originalPosition: MappedPosition): Position[];
    }

    namespace SourceMapConsumer {
        function fromSourceMap(sourceMap: SourceMapGenerator): SourceMapConsumer;
        var GREATEST_LOWER_BOUND: number;
        var LEAST_UPPER_BOUND: number;
    }
}

export { StartOfSourceMap };

export interface SourcePosition {
    uri: string;
    position: Position;
    name?: string;
}

export namespace SourcePosition {
    export function create(uri: string, position: Position, name?: string): SourcePosition {
        if (!Is.isString(uri)) throw new Error("invalid argument: uri");
        if (!Position.is(position)) throw new Error("invalid argument: position");
        if (!Is.isMissingOr(Is.isString, name)) throw new Error("invalid argument: name");
        return { uri, position, name };
    }

    export function format(position: SourcePosition) {
        return position
            ? `${position.uri}:${position.position.line + 1}:${position.position.character + 1}`
            : undefined;
    }

    export function is(value: any): value is SourcePosition {
        return Is.isObject(value)
            && Is.isString(value.uri)
            && Position.is(value.position)
            && Is.isMissingOr(Is.isString, value.name);
    }
}

export interface SourceRange {
    uri: string;
    range: Range;
}

export namespace SourceRange {
    export function create(uri: string, range: Range): SourceRange;
    export function create(uri: string, start: Position, end: Position): SourceRange;
    export function create(uri: string, rangeOrStart: Range | Position, end?: Position): SourceRange {
        let range: Range;
        if (typeof uri !== "string") throw new Error("invalid argument: uri");
        if (arguments.length >= 3) {
            if (!Position.is(rangeOrStart)) throw new Error("invalid argument: start");
            if (!Position.is(end)) throw new Error("invalid argument: end");
            range = Range.create(rangeOrStart, end);
        }
        else {
            if (!Range.is(rangeOrStart)) throw new Error("invalid argument: range");
            range = rangeOrStart;
        }

        return { uri, range };
    }

    export function format(position: SourceRange) {
        return position
            ? `${position.uri}:${position.range.start.line + 1}:${position.range.start.character + 1}-${position.range.end.line + 1}:${position.range.end.character + 1}`
            : undefined;
    }

    export function is(value: any): value is SourceRange {
        return Is.isObject(value)
            && Is.isString(value.uri)
            && Range.is(value.range);
    }
}

export interface Mapping {
    generatedPosition: Position;
    sourcePosition?: SourcePosition;
}

export namespace Mapping {
    export function create(generatedPosition: Position, sourcePosition?: SourcePosition): Mapping {
        if (!Position.is(generatedPosition)) throw new TypeError("invalid argument: generatedPosition");
        if (!Is.isMissingOr(SourcePosition.is, sourcePosition)) throw new TypeError("invalid argument: sourcePosition");
        return { generatedPosition, sourcePosition };
    }

    export function is(value: any): value is Mapping {
        return Is.isObject(value)
            && Position.is(value.generatedPosition)
            && Is.isMissingOr(SourcePosition.is, value.sourcePosition);
    }
}

interface IndexedMapping {
    generatedLine: number;
    generatedCharacter: number;
    sourceIndex: number;
    sourceLine: number;
    sourceCharacter: number;
    nameIndex: number;
}

export const enum Order {
    Generated = 1,
    Source = 2
}

export const enum Bias {
    GreatestLowerBound = 1,
    LeastUpperBound = 2,

    Adjusted = 4,
    AdjustedGreatestLowerBound = GreatestLowerBound | Adjusted,
    AdjustedLeastUpperBound = LeastUpperBound | Adjusted
}

export class SourceMap {
    private _header: StartOfSourceMap;
    private _writer: SourceMapGenerator;
    private _reader: SourceMapConsumer;
    private _sources: ArraySet<string>;
    private _names: ArraySet<string>;
    private _generatedMappings: SortedList<IndexedMapping>;
    private _sourceMappings: SortedList<IndexedMapping>;

    constructor(header: StartOfSourceMap) {
        this._header = header;
        this._writer = new SourceMapGenerator(header);
        this._sources = new ArraySet<string>();
        this._names = new ArraySet<string>();
        this._generatedMappings = new SortedList<IndexedMapping>((x, y) =>
            compareValues(x.generatedLine, y.generatedLine)
            || compareValues(x.generatedCharacter, y.generatedCharacter)
            || compareValues(x.sourceIndex, y.sourceIndex)
            || compareValues(x.sourceLine, y.sourceLine)
            || compareValues(x.sourceCharacter, y.sourceCharacter)
            || compareValues(x.nameIndex, y.nameIndex));

        this._sourceMappings = new SortedList<IndexedMapping>((x, y) =>
            compareValues(x.sourceIndex, y.sourceIndex)
            || compareValues(x.sourceLine, y.sourceLine)
            || compareValues(x.sourceCharacter, y.sourceCharacter)
            || compareValues(x.nameIndex, y.nameIndex)
            || compareValues(x.generatedLine, y.generatedLine)
            || compareValues(x.generatedCharacter, y.generatedCharacter));
    }

    public get file() { return this._header.file; }
    public get sourceRoot() { return this._header.sourceRoot; }
    public get sources() { return this._sources.toArray(); }
    public get names() { return this._names.toArray(); }

    public sourceRangeFor(generatedRange: Range, bias = Bias.GreatestLowerBound): SourceRange | undefined {
        const start = this.sourcePositionFor(generatedRange.start, bias);
        const end = this.sourcePositionFor(generatedRange.end, bias);
        if (start && end && start.uri === end.uri) {
            return SourceRange.create(start.uri, start.position, end.position);
        }
    }

    public sourcePositionFor(generatedPosition: Position, bias = Bias.GreatestLowerBound): SourcePosition | undefined {
        this.switchToReadMode();

        const { source, line, column, name } = this._reader.originalPositionFor({
            line: generatedPosition.line + 1,
            column: generatedPosition.character,
            bias: bias & ~Bias.Adjusted
        });

        if (Is.isString(source) && Is.isNumber(line) && Is.isNumber(column) && Is.isMissingOr(Is.isString, name)) {
            const sourcePosition = SourcePosition.create(source, Position.create(line - 1, column), name);
            if (bias & Bias.Adjusted) {
                const other = this.generatedPositionFor(sourcePosition, bias & ~Bias.Adjusted);
                sourcePosition.position.character += generatedPosition.character - other.character;
            }

            return sourcePosition;
        }

        return undefined;
    }

    public generatedRangeFor(sourceRange: SourceRange, bias = Bias.GreatestLowerBound): Range | undefined {
        const start = this.generatedPositionFor(SourcePosition.create(sourceRange.uri, sourceRange.range.start), bias);
        const end = this.generatedPositionFor(SourcePosition.create(sourceRange.uri, sourceRange.range.end), bias);
        if (start && end) {
            return Range.create(start, end);
        }
    }

    public generatedPositionFor(sourcePosition: SourcePosition, bias = Bias.GreatestLowerBound): Position | undefined {
        this.switchToReadMode();

        const { line, column } = this._reader.generatedPositionFor({
            source: sourcePosition.uri,
            line: sourcePosition.position.line + 1,
            column: sourcePosition.position.character,
            bias: bias & ~Bias.Adjusted
        });

        if (Is.isNumber(line) && Is.isNumber(column)) {
            const generatedPosition = Position.create(line - 1, column);
            if (bias & Bias.Adjusted) {
                const other = this.sourcePositionFor(generatedPosition, bias & ~Bias.Adjusted);
                generatedPosition.character += sourcePosition.position.character - other.position.character;
            }

            return generatedPosition;
        }

        return undefined;
    }

    public allGeneratedPositionsFor(sourcePosition: SourcePosition): Position[] {
        this.switchToReadMode();
        const positions = this._reader.allGeneratedPositionsFor({
            source: sourcePosition.uri,
            line: sourcePosition.position.line + 1,
            column: sourcePosition.position.character
        });

        return positions.map(({ line, column }) => Position.create(line - 1, column));
    }

    public forEachMapping(callback: (mapping: Mapping) => void, order = Order.Generated): void {
        this.switchToReadMode();
        const mappings = order === Order.Source ? this._sourceMappings : this._generatedMappings;
        for (let i = 0; i < mappings.size; i++) {
            const mapping = mappings.valueAt(i);
            const source = this._sources.valueAt(mapping.sourceIndex);
            const name = this._names.valueAt(mapping.nameIndex);
            const generatedPosition = Position.create(mapping.generatedLine, mapping.generatedCharacter);
            const sourcePosition = mapping.sourceLine >= 0 ? Position.create(mapping.sourceLine, mapping.sourceCharacter) : undefined;
            callback(Mapping.create(generatedPosition, sourcePosition && SourcePosition.create(source, sourcePosition, name)));
        }
    }

    public addMapping(generatedPosition: Position, sourcePosition?: SourcePosition): void {
        if (!Position.is(generatedPosition)) throw new TypeError("invalid argument: generatedPosition");
        if (!Is.isMissingOr(SourcePosition.is, sourcePosition)) throw new TypeError("invalid argument: sourcePosition");
        this.switchToWriteMode();

        const generated = { line: generatedPosition.line + 1, column: generatedPosition.character };
        const original = sourcePosition && { line: sourcePosition.position.line + 1, column: sourcePosition.position.character };
        const source = sourcePosition && sourcePosition.uri;
        const name = sourcePosition && sourcePosition.name;

        this._writer.addMapping({ generated, original, source, name });

        const mapping: IndexedMapping = {
            generatedLine: generatedPosition.line,
            generatedCharacter: generatedPosition.character,
            sourceIndex: source ? this._sources.add(source) : -1,
            sourceLine: sourcePosition ? sourcePosition.position.line : -1,
            sourceCharacter: sourcePosition ? sourcePosition.position.character : -1,
            nameIndex: name ? this._names.add(name) : -1
        };

        this._generatedMappings.add(mapping);

        if (sourcePosition) {
            this._sourceMappings.add(mapping);
        }
    }

    public applySourceMap(sourceMap: SourceMap, sourceFile?: string, sourceMapPath?: string): void {
        this.switchToWriteMode();
        sourceMap.switchToReadMode();
        this._writer.applySourceMap(sourceMap._reader, sourceFile, sourceMapPath);
    }

    public toJSON(): any {
        return this._writer.toJSON();
    }

    public toString(): string {
        return this._writer.toString();
    }

    private switchToWriteMode() {
        this._reader = undefined;
    }

    private switchToReadMode() {
        if (!this._reader) {
            this._reader = SourceMapConsumer.fromSourceMap(this._writer);
        }
    }
}
