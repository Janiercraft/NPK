require("dotenv").config();

const app = require("./app");

const connectDB = require("./config/database");

connectDB();

require("./services/mqttService");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});