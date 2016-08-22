// imports
const gulp = require("gulp");
const sourcemaps = require("gulp-sourcemaps");
const convert = require("gulp-convert");
const rename = require("gulp-rename");
const tsb = require("gulp-tsb");
const del = require("del");

// projecs
const client = tsb.create("src/client");
const server = tsb.create("src/server");

gulp.task("clean", () => del(["out/**/*"]));

gulp.task("client", () => client.src()
    .pipe(sourcemaps.init())
    .pipe(client.compile())
    .pipe(sourcemaps.write(".", { includeContent: false, destPath: "out/client" }))
    .pipe(gulp.dest("out/client")));

gulp.task("server", () => server.src()
    .pipe(sourcemaps.init())
    .pipe(server.compile())
    .pipe(sourcemaps.write(".", { includeContent: false, destPath: "out/server" }))
    .pipe(gulp.dest("out/server")));

gulp.task("syntax", () => gulp
    .src("src/syntax/**/*.yaml")
    .pipe(convert({ from: "yml", to: "plist" }))
    .pipe(rename({ extname: ".tmLanguage" }))
    .pipe(gulp.dest("out/syntax")));

gulp.task("build", ["client", "syntax", "server"]);

gulp.task("watch:client", ["client"], () => gulp.watch(client.globs, ["client"]));
gulp.task("watch:server", ["server"], () => gulp.watch(server.globs, ["server"]));
gulp.task("watch:syntax", ["syntax"], () => gulp.watch(["src/syntax/**/*"], ["syntax"]));
gulp.task("watch", ["watch:client", "watch:server", "watch:syntax"]);

gulp.task("default", ["build"]);
