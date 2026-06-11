require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/database");
const { startHistoryJob } = require("./services/historyService");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();

    require("./services/mqttService");

    startHistoryJob();

    app.listen(PORT, () => {
      console.log(`Servidor iniciado en puerto ${PORT}`);
    });
  } catch (error) {
    console.error("No se pudo iniciar el servidor:", error.message);
    process.exit(1);
  }
};

startServer();