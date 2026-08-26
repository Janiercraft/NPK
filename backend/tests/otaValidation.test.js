const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateOtaRequest,
  isValidVersion,
  isValidFirmwareUrl,
  isValidSha256
} = require("../src/services/otaService");

const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("valida versión OTA semver básica", () => {
  assert.equal(isValidVersion("1.1.0"), true);
  assert.equal(isValidVersion("v2.0.1"), true);
  assert.equal(isValidVersion("1.1"), false);
});

test("valida URL OTA exclusivamente por HTTPS", () => {
  assert.equal(isValidFirmwareUrl("https://example.com/fw.bin"), true);
  assert.equal(isValidFirmwareUrl("http://example.com/fw.bin"), false);
  assert.equal(isValidFirmwareUrl("not-a-url"), false);
});

test("valida SHA-256 de 64 hex", () => {
  assert.equal(isValidSha256(HASH), true);
  assert.equal(isValidSha256("0".repeat(63)), false);
  assert.equal(isValidSha256("g".repeat(64)), false);
});

test("rechaza solicitud OTA inválida", () => {
  const errors = validateOtaRequest({
    sensorId: "bad id",
    version: "1.1",
    url: "http://example.com/fw.bin",
    sha256: "abc"
  });

  assert.equal(errors.length, 4);
});

test("rechaza size OTA no entero", () => {
  const { validateOtaRequest } = require("../src/services/otaService");
  const errors = validateOtaRequest({
    sensorId: "001",
    version: "1.2.0",
    url: "https://example.com/fw.bin",
    sha256: HASH,
    size: 123.5
  });
  assert.equal(errors.some((error) => error.includes("size inválido")), true);
});

test("acepta estados de error MQTT como terminales", () => {
  const { TERMINAL_STATUSES } = require("../src/services/otaService");
  assert.equal(TERMINAL_STATUSES.has("MQTT_ERROR"), true);
  assert.equal(TERMINAL_STATUSES.has("MQTT_PUBLISH_FAILED"), true);
});


test("considera OTA_SUCCESS como actualización ya completada", () => {
  const { SUCCESSFUL_STATUSES } = require("../src/services/otaService");
  assert.equal(SUCCESSFUL_STATUSES.has("OTA_SUCCESS"), true);
  assert.equal(SUCCESSFUL_STATUSES.has("SUCCESS"), true);
});

test("permite reintentos para estados de error", () => {
  const { TERMINAL_STATUSES, SUCCESSFUL_STATUSES } = require("../src/services/otaService");
  assert.equal(TERMINAL_STATUSES.has("OTA_ERROR"), true);
  assert.equal(SUCCESSFUL_STATUSES.has("OTA_ERROR"), false);
  assert.equal(TERMINAL_STATUSES.has("MQTT_ERROR"), true);
  assert.equal(SUCCESSFUL_STATUSES.has("MQTT_ERROR"), false);
});

test("trata OTA_ROLLBACK_SUCCESS como estado terminal, no como éxito de instalación", () => {
  const { TERMINAL_STATUSES, SUCCESSFUL_STATUSES } = require("../src/services/otaService");
  assert.equal(TERMINAL_STATUSES.has("OTA_ROLLBACK_SUCCESS"), true);
  assert.equal(SUCCESSFUL_STATUSES.has("OTA_ROLLBACK_SUCCESS"), false);
  assert.equal(TERMINAL_STATUSES.has("OTA_ROLLBACK"), false);
});

