import { createConnection, IPCMessageReader, IPCMessageWriter } from "vscode-languageserver";
import { Server } from "./server";
import { install } from "source-map-support";

install();

const connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
connection.listen();

const server = new Server();
server.listen(connection);