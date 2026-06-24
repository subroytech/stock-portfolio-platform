const express = require('express');
const contrarianFinderController = require('../controllers/contrarianFinder.controller');

const router = express.Router();

router.post('/scan', contrarianFinderController.scan);

module.exports = router;
