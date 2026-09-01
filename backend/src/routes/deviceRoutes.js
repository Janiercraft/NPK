const express = require("express");
const router = express.Router();

const mqttClient = require("../services/mqttService");
const {
  requestOtaUpdate,
  getOtaStatus,
  getOtaHistory
} = require("../controllers/otaController");

router.post("/on", (req, res) => {
  mqttClient.publish("npk/001/cmd", "ON");
  res.json({ ok: true, command: "ON" });
});

router.post("/off", (req, res) => {
  mqttClient.publish("npk/001/cmd", "OFF");
  res.json({ ok: true, command: "OFF" });
});


router.post("/:sensor_id/control", (req, res) => {
  const sensorId = String(req.params.sensor_id || "").trim();
  const command = String(req.body?.command || "SENSOR_CONTROL").toUpperCase();

  if (!sensorId) return res.status(400).json({ ok: false, message: "sensor_id es obligatorio." });

  let payload;
  if (command === "RESTART") {
    payload = "RESTART";
  } else if (command === "ALL_SENSORS") {
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ ok: false, message: "enabled debe ser boolean." });
    payload = JSON.stringify({ command: "ALL_SENSORS", enabled: req.body.enabled });
  } else if (command === "SENSOR_CONTROL") {
    const allowed = ["npk", "temperature", "soil_moisture"];
    const sensor = String(req.body?.sensor || "").toLowerCase();
    if (!allowed.includes(sensor)) return res.status(400).json({ ok: false, message: "sensor debe ser npk, temperature o soil_moisture." });
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ ok: false, message: "enabled debe ser boolean." });
    payload = JSON.stringify({ command: "SENSOR_CONTROL", sensor, enabled: req.body.enabled });
  } else {
    return res.status(400).json({ ok: false, message: `Comando no soportado: ${command}` });
  }

  const topic = `npk/${encodeURIComponent(sensorId)}/cmd`;
  mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
    if (error) return res.status(503).json({ ok: false, message: error.message });
    res.json({ ok: true, sensor_id: sensorId, topic, command, payload });
  });
});

router.get("/:sensor_id/control/status", (req, res) => {
  const status = mqttClient.getDeviceStatus(req.params.sensor_id);
  if (!status) return res.status(404).json({ ok: false, message: "Aún no hay estado MQTT del dispositivo." });
  res.json({ ok: true, ...status });
});

router.post("/:sensor_id/ota", requestOtaUpdate);
router.get("/:sensor_id/ota/status", getOtaStatus);
router.get("/:sensor_id/ota/history", getOtaHistory);

module.exports = router;
