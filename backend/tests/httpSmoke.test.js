require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const app = require("../src/app");
const mqttService = require("../src/services/mqttService");

let server;
let baseUrl;

const request = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json();
  return { response, body };
};

test.before(async () => {
  process.env.OTA_VERSION = "1.1.0";
  process.env.OTA_URL = "https://example.com/NPK_Smart_Cacao_1.1.0.bin";
  process.env.OTA_SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.OTA_SIZE = "1234567";

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test("GET / responde", async () => {
  const { response, body } = await request("/");
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
});

test("GET /api/health responde", async () => {
  const { response, body } = await request("/api/health");
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "backend");
});

test("GET /api/ota/manifest devuelve el manifest configurado", async () => {
  const { response, body } = await request("/api/ota/manifest");
  assert.equal(response.status, 200);
  assert.equal(body.version, "1.1.0");
  assert.equal(body.url, "https://example.com/NPK_Smart_Cacao_1.1.0.bin");
  assert.equal(body.sha256.length, 64);
  assert.equal(body.size, 1234567);
});

test.after(async () => {
  server?.close();
  mqttService.client.end(true);
});
