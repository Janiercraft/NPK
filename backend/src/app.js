const express = require("express");
const cors = require("cors");

const deviceRoutes = require("./routes/deviceRoutes");
const sensorRoutes = require("./routes/sensorRoutes");
const logRoutes = require("./routes/logRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/device", deviceRoutes);
app.use("/api/sensor", sensorRoutes);
app.use("/api/logs", logRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "backend",
    timestamp: new Date()
  });
});

module.exports = app;
