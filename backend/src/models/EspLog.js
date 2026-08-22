const mongoose = require("mongoose");

const espLogSchema = new mongoose.Schema(
  {
    sensor_id: {
      type: String,
      default: null,
      index: true
    },

    topic: {
      type: String,
      required: true,
      index: true
    },

    level: {
      type: String,
      default: "INFO",
      index: true
    },

    message: {
      type: String,
      default: ""
    },

    raw_payload: {
      type: String,
      required: true
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },

    device_timestamp: {
      type: Date,
      default: null
    },

    received_at: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    strict: false
  }
);

espLogSchema.index({ sensor_id: 1, received_at: -1 });
espLogSchema.index({ topic: 1, received_at: -1 });
espLogSchema.index({ level: 1, received_at: -1 });

module.exports = mongoose.model("EspLog", espLogSchema, "LogsESP");
