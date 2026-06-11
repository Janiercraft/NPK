const cron = require("node-cron");
const SensorData = require("../models/SensorData");
const SensorHistory = require("../models/SensorHistory");

const moveOldDataToHistory = async () => {
  try {
    const limitDate = new Date();
    limitDate.setMinutes(limitDate.getMinutes() - 1);

    const oldData = await SensorData.find({
      timestamp: { $lt: limitDate }
    }).lean();

    if (!oldData.length) {
      console.log("No hay datos antiguos para mover a históricos");
      return;
    }

    await SensorHistory.insertMany(oldData, { ordered: false });

    const ids = oldData.map(doc => doc._id);

    await SensorData.deleteMany({
      _id: { $in: ids }
    });

    console.log(`${oldData.length} datos movidos a históricos`);
  } catch (error) {
    console.error("Error moviendo datos a históricos:", error.message);
  }
};

const startHistoryJob = () => {
  cron.schedule("0 2 * * *", moveOldDataToHistory, {
    timezone: "America/Bogota"
  });

  console.log("Job de históricos programado diariamente a las 2:00 AM");
};

module.exports = {
  moveOldDataToHistory,
  startHistoryJob
};