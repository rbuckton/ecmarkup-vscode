import { IConnection, Range, Position, DidChangeConfigurationParams } from "vscode-languageserver";
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

export class SortedList<V, K> {
    private _values: V[];
    private _keySelector: (x: V) => K;
    private _keyComparer: (x: K, y: K) => number;

    constructor(keySelector: (x: V) => K, keyComparer: (x: K, y: K) => number) {
        this._values = [];
        this._keySelector = keySelector;
        this._keyComparer = keyComparer;
    }

    public get size() {
        return this._values.length;
    }

    public has(value: V) {
        return this.indexOf(value) >= 0;
    }

    public hasKey(key: K) {
        return this.indexOfKeyCore(key) >= 0;
    }

    public add(value: V) {
        const index = this.indexOfKeyCore(this._keySelector(value));
        insert(this._values, value, index < 0 ? ~index : index + 1);
    }

    public valueAt(index: number) {
        return this._values[index];
    }

    public valueFor(key: K) {
        const index = this.indexOfKeyCore(key);
        return index >= 0 ? this._values[index] : undefined;
    }

    public indexOf(value: V) {
        const key = this._keySelector(value);
        const index = this.indexOfKeyCore(key);
        if (index >= 0) {
            for (let i = index; i < this._values.length; i++) {
                if (this._values[i] === value) {
                    return i;
                }

                if (this._keySelector(this._values[i]) !== key) {
                    break;
                }
            }
        }
        return -1;
    }

    public indexOfKey(key: K) {
        const index = this.indexOfKeyCore(key);
        return index < 0 ? -1 : index;
    }

    public delete(value: V) {
        return removeAt(this._values, this.indexOf(value));
    }

    public deleteKey(key: K) {
        return removeAt(this._values, this.indexOfKeyCore(key));
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

    private indexOfKeyCore(key: K) {
        return binarySearch(this._values, key, this._keyComparer, this._keySelector);
    }
}

export class Stack<T> {
    private _top: T | undefined = undefined;
    private _stack: T[] | undefined = undefined;
    private _size: number = 0;

    constructor(values?: T[]) {
        if (values) {
            for (const value of values) {
                this.push(value);
            }
        }
    }

    public get size() { return this._size; }

    public push(value: T) {
        if (this._size > 0) {
            if (this._stack === undefined) {
                this._stack = [this._top];
            }
            else {
                this._stack.push(this._top);
            }
        }

        this._top = value;
        this._size++;
        return this._size;
    }

    public peek(offset: number = 0): T | undefined {
        if (this._size === 0) return undefined;
        if (offset >= this._size) return undefined;
        if (offset === 0) return this._top;
        return this._stack ? this._stack[this._size - offset - 1] : undefined;
    }

    public pop(): T | undefined {
        if (this._size === 0) return undefined;
        const value = this._top;
        this._top = this._size > 1 && this._stack !== undefined ? this._stack.pop() : undefined;
        this._size--;
        return value;
    }

    public clear() {
        this._top = undefined;
        this._stack = undefined;
        this._size = 0;
    }

    public toArray(): T[] {
        if (this._size === 0) return [];
        if (this._size > 1 && this._stack) return [...this._stack, this._top];
        return [this._top];
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

export function binarySearch<T>(array: T[], value: T, comparer?: (x: T, y: T) => number): number;
export function binarySearch<T, K>(array: T[], key: K, keyComparer: (x: K, y: K) => number, keySelector: (x: T) => K): number;
export function binarySearch<T, K>(array: T[], key: K, keyComparer: (x: K, y: K) => number = compareValues, keySelector: (x: T) => K = identity): number {
    let low = 0;
    let high = array.length - 1;
    while (low <= high) {
        const middle = low + ((high - low) >> 1);
        const midValue = array[middle];
        const midKey = keySelector(midValue);
        const res = keyComparer(midKey, key);
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

function identity<T>(value: T) {
    return value;
}

export function compareValues<T>(x: T, y: T) {
    return x > y ? +1 : x < y ? -1 : 0;
}

export function formatPosition(x: Position) {
    return `${x.line + 1}:${x.character + 1}`;
}

export function formatRange(x: Range) {
    return `${formatPosition(x.start)}:${formatPosition(x.end)}`;
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

export const enum TraceLevel {
    off,
    error,
    warning,
    info,
    verbose
}

function toTraceLevel(text: string) {
    switch (text) {
        case "0":
        case "off": return TraceLevel.off;
        case "1":
        case "error": return TraceLevel.error;
        case "2":
        case "warning": return TraceLevel.warning;
        case "3":
        case "info": return TraceLevel.info;
        case "4":
        case "verbose": return TraceLevel.verbose;
    }
}

export class TraceSwitch {
    private static connection: IConnection;
    private static switches = new Map<string, number>();
    private _name: string;
    private _enabled: boolean;

    constructor(name: string, enabled = true) {
        this._name = name;
        this._enabled = enabled;
    }

    get name() { return this._name; }
    get enabled() { return this._enabled; }

    static shouldTrace(name: string, level: TraceLevel) {
        if (this.switches.has(name)) {
            return this.switches.get(name) >= level;
        }
        if (this.switches.has("server")) {
            return this.switches.get("server") >= level;
        }
        if (this.switches.has("all")) {
            return this.switches.get("all") >= level;
        }
        return false;
    }

    static listen(connection: IConnection) {
        if (!this.connection) {
            this.connection = connection;
            this.connection.onDidChangeConfiguration(params => this.onDidChangeConfiguration(params));
        }
    }

    static setTraceLevel(name: string, level: TraceLevel) {
        if (name === "none") return;
        this.switches.set(name, level);
    }

    private static onDidChangeConfiguration({ settings }: DidChangeConfigurationParams) {
        this.switches.clear();

        const trace = settings.ecmarkup.trace;
        if (typeof trace === "string") {
            this.setTraceLevel(trace, TraceLevel.verbose);
        }
        else if (Array.isArray(trace)) {
            for (const name of trace) {
                this.setTraceLevel(name, TraceLevel.verbose);
            }
        }
        else if (typeof trace === "object") {
            for (const key of Object.keys(trace)) {
                const level = trace[key];
                if (typeof level === "number") {
                    this.setTraceLevel(key, level);
                }
                else if (typeof level === "string") {
                    this.setTraceLevel(key, toTraceLevel(level));
                }
            }
        }
    }

    shouldTrace(level: TraceLevel) {
        return this.enabled
            && !!TraceSwitch.connection
            && TraceSwitch.shouldTrace(this.name, level);
    }

    log(message: string) {
        console.log(`${this.name}: ${message}`);
        if (this.shouldTrace(TraceLevel.verbose)) {
            TraceSwitch.connection.console.log(`${this.name}: ${message}`);
        }
    }

    info(message: string) {
        console.info(`${this.name}: ${message}`);
        if (this.shouldTrace(TraceLevel.info)) {
            TraceSwitch.connection.console.info(`${this.name}: ${message}`);
        }
    }

    warn(message: string) {
        console.warn(`${this.name}: ${message}`);
        if (this.shouldTrace(TraceLevel.warning)) {
            TraceSwitch.connection.console.warn(`${this.name}: ${message}`);
        }
    }

    error(message: string) {
        console.error(`${this.name}: ${message}`);
        if (this.shouldTrace(TraceLevel.error)) {
            TraceSwitch.connection.console.error(`${this.name}: ${message}`);
        }
    }
}

if (process.env.EMU_TRACE) {
    TraceSwitch.setTraceLevel(process.env.EMU_TRACE, toTraceLevel(process.env.EMU_TRACE_LEVEL || "verbose"));
}