const express = require("express");
const { getManifest } = require("../controllers/otaController");

const router = express.Router();

router.get("/manifest", getManifest);

module.exports = router;
