import { Position } from "vscode-languageserver";
import { SourcePosition } from "./sourceMap";
import * as url from "url";
import * as path from "path";

export namespace Is {
    export function isMissing(value: any): value is undefined | null {
        return value === undefined
            || value === null;
    }

    export function isMissingOr<T>(is: (value: any) => value is T, value: any): value is T | undefined | null {
        return value === undefined
            || value === null
            || is(value);
    }

    export function isDefined<T>(value: T | undefined | null): value is T {
        return value !== undefined
            && value !== null;
    }

    export function isDefinedAnd<T>(is: (value: any) => value is T, value: any): value is T {
        return value !== undefined
            && value !== null
            && is(value);
    }

    export function isObject(value: any): boolean {
        return value !== null
            && typeof value === "object";
    }

    export function isFunction(value: any): value is Function {
        return typeof value === "function";
    }

    export function isString(value: any): value is string {
        return typeof value === "string";
    }

    export function isNumber(value: any): value is number {
        return typeof value === "number";
    }
}

export function isMissing(value: any): value is undefined | null {
    return value === undefined
        || value === null;
}

export function isMissingOr<T>(is: (value: any) => value is T, value: any): value is T | undefined | null {
    return value === undefined
        || value === null
        || is(value);
}

export function isDefined<T>(value: T | undefined | null): value is T {
    return value !== undefined
        && value !== null;
}

export function isDefinedAnd<T>(is: (value: any) => value is T, value: any): value is T {
    return value !== undefined
        && value !== null
        && is(value);
}

export function isObject<T>(value: T | string | number | boolean | undefined | null): value is T;
export function isObject(value: any): boolean;
export function isObject(value: any): boolean {
    return value !== null
        && typeof value === "object";
}

export function isFunction(value: any): value is Function {
    return typeof value === "function";
}

export function isString(value: any): value is string {
    return typeof value === "string";
}

export function isNumber(value: any): value is number {
    return typeof value === "number";
}

export class ArraySet<T> {
    private _values: T[];

    constructor(values?: T[]) {
        this._values = values ? values.slice() : [];
    }

    public get size() {
        return this._values.length;
    }

    public has(value: T) {
        return this._values.indexOf(value) >= 0;
    }

    public add(value: T) {
        const index = this._values.indexOf(value);
        return index >= 0 ? index : this._values.push(value) - 1;
    }

    public valueAt(index: number) {
        return this._values[index];
    }

    public indexOf(value: T) {
        return this._values.indexOf(value);
    }

    public delete(value: T) {
        return remove(this._values, value);
    }

    public deleteAt(index: number) {
        return removeAt(this._values, index);
    }

    public clear() {
        this._values = [];
    }

    public toArray(): T[] {
        return this._values.slice();
    }

    public toJSON(): any {
        return this.toArray();
    }

    public toString() {
        return this._values.join();
    }
}

export class SortedList<T> {
    private _values: T[];
    private _comparison: (x: T, y: T) => number;

    constructor();
    constructor(values: T[]);
    constructor(comparison: (x: T, y: T) => number);
    constructor(values: T[], comparison: (x: T, y: T) => number);
    constructor(valuesOrComparison?: T[] | ((x: T, y: T) => number), relationalComparison?: (x: T, y: T) => number) {
        this._values = Array.isArray(valuesOrComparison) ? valuesOrComparison : [];
        this._comparison = Is.isFunction(valuesOrComparison) ? valuesOrComparison : relationalComparison || compareValues;
    }

    public get size() {
        return this._values.length;
    }

    public has(value: T) {
        return binarySearch(this._values, value, this._comparison) >= 0;
    }

    public add(value: T) {
        const index = binarySearch(this._values, value, this._comparison);
        insert(this._values, value, index < 0 ? ~index : index + 1);
    }

    public valueAt(index: number) {
        return this._values[index];
    }

    public indexOf(value: T) {
        const index = binarySearch(this._values, value, this._comparison);
        return index < 0 ? -1 : index;
    }

    public delete(value: T) {
        return removeAt(this._values, binarySearch(this._values, value, this._comparison));
    }

    public deleteAt(index: number) {
        return removeAt(this._values, index);
    }

    public clear() {
        this._values = [];
    }

    public toArray() {
        return this._values.slice();
    }

    public toJSON(): any {
        return this.toArray();
    }

    public toString() {
        return this._values.join();
    }
}

function insert<T>(array: T[], value: T, index: number) {
    for (let i = array.length; i > index; i++) {
        array[i] = array[i - 1];
    }
    array[index] = value;
}

function remove<T>(array: T[], value: T) {
    return removeAt(array, array.indexOf(value));
}

function removeAt<T>(array: T[], index: number) {
    if (index >= 0 && index < array.length) {
        for (let i = index + 1; i < array.length; i++) {
            array[index - 1] = array[index];
        }
        array.length--;
        return true;
    }
    return false;
}

export function binarySearch<T>(array: T[], value: T, comparison: (x: T, y: T) => number = compareValues): number {
    let low = 0;
    let high = array.length - 1;
    while (low <= high) {
        const middle = low + ((high - low) >> 1);
        const midValue = array[middle];
        const res = comparison(midValue, value);
        if (res === 0) {
            return middle;
        }
        else if (res > 0) {
            high = middle - 1;
        }
        else {
            low = middle + 1;
        }
    }
    return ~low;
}

export function compareValues<T>(x: T, y: T) {
    return x > y ? +1 : x < y ? -1 : 0;
}

export function comparePositions(x: Position, y: Position) {
    return compareValues(x.line, y.line)
        || compareValues(x.character, y.character);
}

export function isUrl(value: string) {
    const parsed = url.parse(value);
    return !!parsed.protocol && !path.isAbsolute(value);
}

export function isFileUrl(value: string) {
    const parsed = url.parse(value);
    return parsed.protocol === "file:";
}

export function toUrl(value: string, referer?: string) {
    if (path.isAbsolute(value)) {
        value = normalizeSlashes(value).split(/\//g).map(encodeURIComponent).join("/");
        return url.format({ protocol: "file:", slashes: true, pathname: value });
    }

    return referer ? url.resolve(referer, value) : value;
}

export function toLocalPath(value: string) {
    if (path.isAbsolute(value)) {
        return value;
    }

    const parsed = url.parse(value);
    if (parsed.protocol === "file:") {
        const pathname = decodeURIComponent(parsed.pathname);
        return /^[\\/][a-z]:/i.test(pathname) ? pathname.slice(1) : pathname;
    }

    return undefined;
}

export function normalizeSlashes(text: string) {
    return text.replace(/\\/g, "/");
}

export function ensureTrailingSeparator(text: string) {
    return /[\\/]$/.test(text) ? text : text + "/";
}
