import * as url from "url";
import * as os from "os";

function encodeComponent(text: string, skipEncoding: boolean) {
    if (!skipEncoding) {
        text = encodeURIComponent(text);
        text = text.replace(/[!'()*]/g, s => "%" + s.charCodeAt(0).toString(16).toUpperCase());
    }
    return text.replace(/[#?]/g, encodeURIComponent);
}

function encodePath(path: string, skipEncoding: boolean) {
    return path
        .replace(/^(\/)?[A-Z]:/, s => s.toLowerCase())
        .split("/")
        .map(component => encodeComponent(component, skipEncoding))
        .join("/");
}

function encodeAuthority(authority: string, skipEncoding) {
    return authority
        .toLowerCase()
        .split(":")
        .map(component => encodeComponent(component, skipEncoding))
        .join(":");
}

export class Uri {
    private _scheme: string = "";
    private _authority: string = "";
    private _path: string = "";
    private _query: string = "";
    private _fragment: string = "";
    private _formatted: string = null;
    private _localPath: string = null;

    private constructor() {
    }

    public get scheme() { return this._scheme; }
    public get authority() { return this._authority; }
    public get path() { return this._path; }
    public get query() { return this._query; }
    public get fragment() { return this._fragment; }
    public get localPath() { return this._localPath || (this._localPath = this.formatLocalPath()); }

    public static parse(value: string): Uri {
        const uri = new Uri();
        const parsed = url.parse(value);
        uri._scheme = parsed.protocol ? parsed.protocol.slice(0, parsed.protocol.length - 1) : "";
        uri._authority = decodeURIComponent(parsed.host);
        uri._path = decodeURIComponent(parsed.pathname);
        uri._query = parsed.search ? decodeURIComponent(parsed.search.slice(1)) : "";
        uri._fragment = parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : "";
        return uri;
    }

    public static file(path: string): Uri {
        const uri = new Uri();
        uri._scheme = "file";
        path = path.replace(/\\/g, "/");
        const match = /^\/\/([^\/]*)(.*)$/.exec(path);
        if (match) {
            uri._authority = match[1];
            uri._path = match[2] || "";
        }
        else if (/^\//.test(path)) {
            uri._path = path;
        }
        else {
            uri._path = "/" + path;
        }
        return uri;
    }

    public static from(components: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
        return new Uri().with(components);
    }

    public with(components?: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
        if (!components) return this;
        let { scheme = this.scheme, authority = this.authority, path = this.path, query = this.query, fragment = this.fragment } = components;
        if (scheme === null) scheme = "";
        if (authority === null) authority === "";
        if (path === null) path = "";
        if (query === null) query = "";
        if (fragment === null) fragment = "";
        if (scheme === this.scheme && authority === this.authority && path === this.path && query === this.query && fragment === this.fragment) return this;
        const uri = new Uri();
        uri._scheme = scheme;
        uri._authority = authority;
        uri._path = path;
        uri._query = query;
        uri._fragment = fragment;
        return uri;
    }

    public toString(skipEncoding = false) {
        if (!skipEncoding && this._formatted) return this._formatted;
        const parts: string[] = [];
        const { scheme, authority, path, query, fragment } = this;
        if (scheme) parts.push(scheme, ":");
        if (authority || scheme === "file") parts.push("//");
        if (authority) parts.push(encodeAuthority(authority, skipEncoding));
        if (path) parts.push(encodePath(path, skipEncoding));
        if (query) parts.push("?", encodeComponent(query, skipEncoding));
        if (fragment) parts.push("#", encodeComponent(fragment, skipEncoding));
        return skipEncoding ? parts.join("") : this._formatted = parts.join("");
    }

    private formatLocalPath() {
        let localPath: string;
        if (this._authority && this._path && this._scheme === "file") {
            localPath = `//${this._authority}${this._path}`;
        }
        else if (/^\/[a-c]:/i.test(this._path)) {
            localPath = this._path.charAt(1).toLowerCase() + this._path.slice(2);
        }
        else {
            localPath = this._path;
        }
        return os.platform() === "win32" ? localPath.replace(/\//g, "\\") : localPath;
    }
}