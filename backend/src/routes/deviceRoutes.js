const express = require("express");
const router = express.Router();

const mqttClient = require("../services/mqttService");

router.post("/on", (req, res) => {
  mqttClient.publish("npk/001/cmd", "ON");
  res.json({ ok: true, command: "ON" });
});

router.post("/off", (req, res) => {
  mqttClient.publish("npk/001/cmd", "OFF");
  res.json({ ok: true, command: "OFF" });
});

module.exports = router;