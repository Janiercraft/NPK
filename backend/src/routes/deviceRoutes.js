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

router.post("/:sensor_id/ota", requestOtaUpdate);
router.get("/:sensor_id/ota/status", getOtaStatus);
router.get("/:sensor_id/ota/history", getOtaHistory);

module.exports = router;
