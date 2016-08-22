declare module "ecmarkup" {
    interface Spec {
        toHTML(): string;
        exportBiblio(): any;
    }
    interface BuildOptions {
        status?: "proposal" | "draft" | "standard";
        version?: string;
        title?: string;
        shortname?: string;
        stage?: number;
        copyright?: boolean;
        date?: Date;
        location?: string;
        contributors?: string;
        toc?: boolean;
        oldToc?: boolean;
        verbose?: boolean;
    }
    function build(path: string, fetch: (path: string) => PromiseLike<string>, opts?: BuildOptions): PromiseLike<Spec | undefined>;
}