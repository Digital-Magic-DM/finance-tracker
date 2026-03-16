"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mfapi_service_1 = require("../services/mfapi.service");
const router = (0, express_1.Router)();
router.get('/nav/:isin', async (req, res) => {
    const isin = req.params.isin;
    try {
        const data = await mfapi_service_1.mfapiService.getNavBySchemeCode(isin);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: `Failed to fetch NAV for ${isin}` });
    }
});
router.get('/metrics', (_req, res) => {
    res.json(mfapi_service_1.mfapiService.getMetrics());
});
exports.default = router;
//# sourceMappingURL=mutualfund.js.map