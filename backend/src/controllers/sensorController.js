const SensorData = require("../models/SensorData");

const getLatestData = async (req, res) => {

  try {

    const data = await SensorData
      .findOne()
      .sort({ timestamp: -1 });

    res.json(data);

  } catch (error) {

    res.status(500).json({
      error: error.message
    });

  }

};

module.exports = {
  getLatestData
};