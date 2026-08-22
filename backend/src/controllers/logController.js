const EspLog = require("../models/EspLog");

const parseLimit = (value, fallback = 200) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 5000);
};

const buildFilter = ({ sensor_id, level, topic, start, end }) => {
  const filter = {};

  if (sensor_id && sensor_id !== "todos") {
    filter.sensor_id = sensor_id;
  }

  if (level && level !== "todos") {
    filter.level = String(level).toUpperCase();
  }

  if (topic) {
    filter.topic = topic;
  }

  if (start || end) {
    filter.received_at = {};

    if (start) {
      const date = new Date(start);
      if (!Number.isNaN(date.getTime())) {
        filter.received_at.$gte = date;
      }
    }

    if (end) {
      const date = new Date(end);
      if (!Number.isNaN(date.getTime())) {
        filter.received_at.$lte = date;
      }
    }

    if (!Object.keys(filter.received_at).length) {
      delete filter.received_at;
    }
  }

  return filter;
};

const getLogs = async (req, res) => {
  try {
    const {
      sensor_id,
      level,
      topic,
      start,
      end
    } = req.query;

    const limit = parseLimit(req.query.limit);
    const filter = buildFilter({ sensor_id, level, topic, start, end });

    const logs = await EspLog.find(filter)
      .sort({ received_at: -1, _id: -1 })
      .limit(limit)
      .lean();

    res.json({
      count: logs.length,
      limit,
      logs
    });
  } catch (error) {
    console.error("Error consultando logs ESP32:", error.message);

    res.status(500).json({
      error: error.message
    });
  }
};

const getLatestLogs = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 100);

    const logs = await EspLog.find()
      .sort({ received_at: -1, _id: -1 })
      .limit(limit)
      .lean();

    res.json(logs);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

module.exports = {
  getLogs,
  getLatestLogs
};
