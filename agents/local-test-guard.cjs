// Loaded by Valida before each approved synthetic test file.
const deny = () => { throw new Error("BELLZA_TEST_NETWORK_DENIED"); };
const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const http2 = require("node:http2");
const dgram = require("node:dgram");
const { syncBuiltinESMExports } = require("node:module");

globalThis.fetch = async () => deny();
net.connect = deny;
net.createConnection = deny;
tls.connect = deny;
http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
http2.connect = deny;
dgram.createSocket = deny;
syncBuiltinESMExports();
