const mongoose = require("mongoose");

const sensorHistorySchema = new mongoose.Schema(
  {
    sensor_id: {
      type: String,
      required: true
    },

    nitrogeno: {
      type: Number,
      required: true
    },

    fosforo: {
      type: Number,
      required: true
    },

    potasio: {
      type: Number,
      required: true
    },

    humedad_suelo: {
      type: Number,
      default: null
    },

    temperatura_ambiente: {
      type: Number,
      default: null
    },

    timestamp: {
      type: Date,
      required: true
    },

    archived_at: {
      type: Date,
      default: Date.now
    }
  },
  {
    strict: false
  }
);

sensorHistorySchema.index({ sensor_id: 1, timestamp: -1 });
sensorHistorySchema.index({ timestamp: -1 });

module.exports = mongoose.model(
  "SensorHistory",
  sensorHistorySchema,
  "DatosHistoricos"
);