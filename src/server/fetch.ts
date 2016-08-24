import { Readable } from "stream";
import { EventEmitter } from "events";
import { CancellationToken } from "prex";
import * as utils from "./utils";
import * as url from "url";
import * as http from "http";
import * as https from "https";

interface CacheEntry {
    headers: any;
    httpVersion: string;
    statusCode: number;
    statusMessage: string;
    chunks: Buffer[];
    totalLength: number;
}

const cache = new Map<string, CacheEntry>();

export interface FetchOptions {
    url: string;
    method?: string;
    headers?: any;
    followRedirects?: boolean;
    maxRedirects?: number;
    noCache?: boolean;
    content?: string | Buffer | Readable;
}

export interface FetchStringOptions extends FetchOptions {
    encoding?: string;
}

export interface FetchObjectOptions extends FetchOptions {
    reviver?: (key: any, value: any) => any;
}

export function fetch(options: string | FetchOptions, token = CancellationToken.none) {
    const request = new WebRequest(options);
    token.register(() => request.abort());
    return request.waitForResponse();
}

export function fetchString(options: string | FetchStringOptions, token = CancellationToken.none) {
    const encoding = utils.isObject(options) && options.encoding;
    return fetch(options, token).then(response => response.waitForContent(encoding || "utf8"));
}

export function fetchObject(options: string | FetchObjectOptions, cb?: (response: any) => void): Promise<any>;
export function fetchObject<T>(options: string | FetchObjectOptions, cb: (response: T) => void): Promise<T>;
export function fetchObject<T>(options: string | FetchObjectOptions, cb?: (response: T) => void) {
    const reviver = utils.isObject(options) && options.reviver;
    return fetchString(options).then(content => JSON.parse(content, reviver));
}

type RequestState = "pending" | "sending" | "closed";

export class WebRequest extends EventEmitter {
    private _method: string;
    private _url: string;
    private _headers: any;
    private _headersLower: any;
    private _followRedirects: boolean;
    private _maxRedirects: number;
    private _redirectAttempt: number = 0;
    private _noCache: boolean;
    private _content: string | Buffer | Readable;
    private _state: RequestState = "pending";
    private _currentRequest: http.ClientRequest;
    private _onResponse = (response: http.IncomingMessage) => this._handleResponse(response);
    private _onError = (error: any) => this._handleError(error);
    private _onAbort = () => this._handleAbort();
    private _responsePromise: Promise<WebResponse>;

    constructor(options: string | FetchOptions) {
        super();
        ({
            method: this._method = "GET",
            url: this._url,
            headers: this._headers = {},
            followRedirects: this._followRedirects = true,
            maxRedirects: this._maxRedirects = 25,
            noCache: this._noCache = false,
            content: this._content,
        } = getOptions(options));

        this._headersLower = {};
        for (var name in this._headers) if (this._headers.hasOwnProperty(name)) {
            this._headersLower[name] = this._headers[name];
        }
    }

    public on(event: "response", cb: (response: WebResponse) => void): this;
    public on(event: "abort", cb: () => void): this;
    public on(event: "error", cb: (error: any) => void): this;
    public on(event: string, cb: Function): this;
    public on(event: string, cb: Function) {
        super.on(event, cb);
        return this;
    }

    public send(): void {
        if (this._state !== "pending") {
            return;
        }

        this._state = "sending";
        this._beginRequest(this._method, this._url);
    }

    public abort(): void {
        if (this._state === "closed") {
            return;
        }

        this._currentRequest.abort();
        this._handleAbort();
    }

    public waitForResponse() {
        return this._responsePromise || (this._responsePromise = new Promise<WebResponse>((resolve, reject) => {
            this.on("response", resolve);
            this.on("error", reject);
            this.send();
        }));
    }

    private _beginRequest(method: string, requestUrl: string) {
        if (this._state !== "sending") {
            return;
        }

        this._method = method;
        this._url = requestUrl;

        if (this._mayUseCache() && cache.has(this._url)) {
            const entry = cache.get(this._url);
            if (entry.headers["etag"]) this._headers["If-None-Match"] = entry.headers["etag"];
            if (entry.headers["last-modified"]) this._headers["If-Modified-Since"] = entry.headers["last-modified"];
        }

        const parsedUrl = url.parse(this._url);
        const makeRequest: typeof https.request = parsedUrl.protocol === "https:" ? https.request : http.request;
        const request = makeRequest({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port ? +parsedUrl.port : undefined,
            method: this._method,
            path: parsedUrl.path,
            headers: this._headers
        }, this._onResponse);
        this._currentRequest = request;

        const content = this._content;
        this._content = undefined;

        if (typeof content === "string") {
            request.write(content, "utf8");
            request.end();
        }
        else if (content instanceof Buffer) {
            request.write(content);
            request.end();
        }
        else if (content instanceof Readable) {
            content.pipe(request, { end: true });
        }
        else {
            request.end();
        }
    }

    private _handleResponse(response: http.IncomingMessage) {
        if (this._isRedirectStatusCode(response) && this._mayFollowRedirect(response)) {
            this._beginRequest("GET", response.headers["location"]);
        }
        else if (this._isNotModifiedStatusCode(response) && this._mayUseCache() && cache.has(this._url)) {
            this._respond(new CachedWebResponse(cache.get(this._url)));
        }
        else if (this._isSuccessStatuscode(response) && this._mayStoreCache(response)) {
            this._respond(new CachingWebResponse(this._url, response, {
                headers: response.headers,
                httpVersion: response.httpVersion,
                statusCode: response.statusCode,
                statusMessage: response.statusMessage,
                chunks: [],
                totalLength: 0
            }));
        }
        else {
            this._respond(new PassthruWebResponse(response));
        }
    }

    private _handleAbort() {
        this._state = "closed";
        this.emit("abort");
    }

    private _handleError(error: any) {
        this.emit("error", error);
    }

    private _respond(response: WebResponse) {
        this._state = "closed";
        this._currentRequest = undefined;
        this.emit("response", response);
    }

    private _isRedirectStatusCode(response: http.IncomingMessage) {
        return response.statusCode === 302
            || response.statusCode === 301;
    }

    private _isNotModifiedStatusCode(response: http.IncomingMessage) {
        return response.statusCode === 304;
    }

    private _isSuccessStatuscode(response: http.IncomingMessage) {
        return response.statusCode >= 200 && response.statusCode < 300;
    }

    private _mayFollowRedirect(response?: http.IncomingMessage) {
        return this._followRedirects
            && this._redirectAttempt++ < this._maxRedirects;
    }

    private _mayUseCache() {
        if (this._noCache || this._method !== "GET") {
            return false;
        }

        const cacheControl = <string>this._headersLower["cache-control"];
        if (cacheControl && /no-cache|no-store|max-age=0/i.test(cacheControl)) {
            return false;
        }

        const pragma = <string>this._headersLower["pragma"];
        if (pragma && /no-cache/i.test(pragma)) {
            return false;
        }

        return true;
    }

    private _mayStoreCache(response: http.IncomingMessage) {
        if (response.statusCode !== 200 || !this._mayUseCache()) {
            return false;
        }

        const cacheControl = <string>response.headers["cache-control"];
        if (cacheControl && /no-cache|no-store|max-age=0/i.test(cacheControl)) {
            return false;
        }

        const expires = <string>response.headers["expires"];
        const date = <string>response.headers["date"];
        if (expires && Date.parse(expires) < (date ? Date.parse(date) : Date.now())) {
            return false;
        }

        return true;
    }
}

export abstract class WebResponse extends Readable {
    public httpVersion: string;
    public headers: any;
    public statusCode: number;
    public statusMessage: string;

    public get isSuccessStatusCode() {
        return this.statusCode >= 200 && this.statusCode < 300;
    }

    public waitForContent(): Promise<Buffer>;
    public waitForContent(encoding: string): Promise<string>;
    public waitForContent(encoding?: string) {
        return encoding ?
            this._waitForContent().then(buffer => buffer.toString(encoding)) :
            this._waitForContent();
    }

    protected abstract _waitForContent(): Promise<Buffer>;
}

class PassthruWebResponse extends WebResponse {
    private _response: http.IncomingMessage;
    private _onData = (chunk: Buffer) => this._handleData(chunk);
    private _onEnd = () => this._handleEnd();
    private _onClose = () => this._handleClose();
    private _onError = (error: any) => this._handleError(error);
    private _chunks: Buffer[];
    private _totalLength: number;
    private _resolve: (buffer: Buffer) => void;
    private _done: boolean;
    private _reading: boolean;
    private _contentPromise: Promise<Buffer>;

    constructor(response: http.IncomingMessage) {
        super();
        this.httpVersion = response.httpVersion;
        this.headers = clone(response.headers);
        this.statusCode = response.statusCode;
        this.statusMessage = response.statusMessage;
        this._response = response;
        this._response.on("error", this._onError);
    }

    public _read(size?: number) {
        this._startReading();
    }

    protected _waitForContent() {
        return this._contentPromise || (this._contentPromise = new Promise<Buffer>((resolve, reject) => {
            if (this._done) {
                resolve(Buffer.concat(this._chunks, this._totalLength));
                this._chunks = undefined;
                this._totalLength = undefined;
                return;
            }

            this._response.on("error", reject);
            this._resolve = resolve;
            this._startReading();
        }));
    }

    private _startReading() {
        if (!this._reading) {
            this._reading = true;
            this._chunks = [];
            this._totalLength = 0;
            this._response.on("data", this._onData);
            this._response.on("end", this._onEnd);
        }
    }

    private _handleData(chunk: Buffer) {
        this._chunks.push(chunk);
        this._totalLength += chunk.length;
        this.push(chunk);
    }

    private _handleEnd() {
        this._done = true;
        if (this._resolve) {
            this._resolve(Buffer.concat(this._chunks, this._totalLength));
            this._chunks = undefined;
            this._totalLength = undefined;
            this._resolve = undefined;
        }

        this.push(null);
    }

    private _handleClose() {
        this.emit("close");
    }

    private _handleError(error: any) {
        this.emit("error", error);
    }
}

class CachingWebResponse extends WebResponse {
    private _url: string;
    private _response: http.IncomingMessage;
    private _cache: CacheEntry;
    private _onData = (chunk: Buffer) => this._handleData(chunk);
    private _onEnd = () => this._handleEnd();
    private _onClose = () => this._handleClose();
    private _onError = (error: any) => this._handleError(error);
    private _contentPromise: Promise<Buffer>;
    private _resolve: (value: Buffer) => void;

    constructor(url: string, response: http.IncomingMessage, cache: CacheEntry) {
        super();
        this.httpVersion = response.httpVersion;
        this.headers = clone(response.headers);
        this.statusCode = response.statusCode;
        this.statusMessage = response.statusMessage;
        this._url = url;
        this._response = response;
        this._cache = cache;
        this._response.on("data", this._onData);
        this._response.on("end", this._onEnd);
        this._response.on("close", this._onClose);
        this._response.on("error", this._onError);
    }

    public _read(size?: number) { }

    protected _waitForContent() {
        return this._contentPromise || (this._contentPromise = new Promise<Buffer>((resolve, reject) => {
            if (cache.has(this._url)) {
                resolve(Buffer.concat(this._cache.chunks, this._cache.totalLength));
                return;
            }

            this._response.on("error", reject);
            this._resolve = resolve;
        }));
    }

    private _handleData(chunk: Buffer) {
        this._cache.chunks.push(chunk);
        this._cache.totalLength += chunk.length;
        this.push(chunk);
    }

    private _handleEnd() {
        cache.set(this._url, this._cache);
        this.push(null);
        if (this._resolve) {
            this._resolve(Buffer.concat(this._cache.chunks, this._cache.totalLength));
            this._resolve = undefined;
        }
    }

    private _handleClose() {
        this.emit("close");
    }

    private _handleError(error: any) {
        this.emit("error", error);
    }
}

class CachedWebResponse extends WebResponse {
    private _cache: CacheEntry;
    private _contentPromise: Promise<Buffer>;

    constructor(cache: CacheEntry) {
        super();
        this.httpVersion = cache.httpVersion;
        this.headers = clone(cache.headers);
        this.statusCode = cache.statusCode;
        this.statusMessage = cache.statusMessage;
        this._cache = cache;
        this.emit("close");
    }

    public _read(size?: number) {
        for (let chunk of this._cache.chunks) {
            this.push(chunk);
        }

        this.push(null);
    }

    protected _waitForContent() {
        return this._contentPromise || (this._contentPromise = new Promise<Buffer>((resolve, reject) => {
            resolve(Buffer.concat(this._cache.chunks, this._cache.totalLength));
        }));
    }
}

function getOptions(options: string | FetchOptions): FetchOptions {
    const _options = <FetchOptions>{};
    if (typeof options === "string") {
        _options.method = "GET";
        _options.url = options;
        _options.headers = {};
        _options.followRedirects = true;
        _options.maxRedirects = 25;
        _options.noCache = false;
    }
    else {
        ({
            method: _options.method = "GET",
            url: _options.url,
            headers: _options.headers = {},
            followRedirects: _options.followRedirects = true,
            maxRedirects: _options.maxRedirects = 25,
            noCache: _options.noCache = false,
        } = options);
    }
    return _options;
}

function clone<T>(source: T): T {
    if (source === undefined) {
        return undefined;
    }

    const clone = Object.create(Object.getPrototypeOf(source));
    for (let name of Object.getOwnPropertyNames(source)) {
        Object.defineProperty(clone, name, Object.getOwnPropertyDescriptor(source, name));
    }

    return clone;
}