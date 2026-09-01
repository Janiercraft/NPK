const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https");

const { resolveFirmwareMetadata } = require("../src/services/otaService");

test("resuelve un redirect HTTPS y obtiene Content-Length final", async (t) => {
  const originalRequest = https.request;
  const calls = [];

  https.request = (url, options, callback) => {
    calls.push({ url: String(url), method: options.method });

    const request = new EventEmitter();
    request.end = () => {
      process.nextTick(() => {
        const response = new EventEmitter();
        response.resume = () => {};

        if (calls.length === 1) {
          response.statusCode = 302;
          response.headers = {
            location: "https://release-assets.githubusercontent.com/test.bin"
          };
        } else {
          response.statusCode = 200;
          response.headers = {
            "content-length": "123456"
          };
        }

        callback(response);
      });
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };

  t.after(() => {
    https.request = originalRequest;
  });

  const result = await resolveFirmwareMetadata(
    "https://github.com/Janiercraft/NPK/releases/download/1.1.1/NPK_Smart_Cacao.ino.bin"
  );

  assert.equal(result.size, 123456);
  assert.equal(result.url, "https://release-assets.githubusercontent.com/test.bin");
  assert.equal(result.redirects, 1);
  assert.deepEqual(calls.map((call) => call.method), ["HEAD", "HEAD"]);
});

test("rechaza una URL de metadata que no usa HTTPS", async () => {
  await assert.rejects(
    () => resolveFirmwareMetadata("http://example.com/firmware.bin"),
    (error) => error.code === "OTA_FIRMWARE_METADATA_ERROR"
  );
});
