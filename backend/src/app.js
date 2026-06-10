const express = require("express");
const cors = require("cors");

const deviceRoutes = require("./routes/deviceRoutes");

const sensorRoutes = require("./routes/sensorRoutes");

const app = express();

app.use("/api/device", deviceRoutes);

app.use(cors());

app.use(express.json());

app.use("/api/sensor", sensorRoutes);

module.exports = app;