const express = require("express");

const router = express.Router();

const {
  getLatestData
} = require("../controllers/sensorController");

router.get("/latest", getLatestData);

module.exports = router;