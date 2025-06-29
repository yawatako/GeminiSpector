"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const factcheck_1 = require("./factcheck");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.post('/factcheck', async (req, res) => {
    const { text } = req.body;
    if (!text)
        return res.status(400).json({ error: 'text required' });
    try {
        const claims = (0, factcheck_1.extractClaims)(text);
        const verifications = await Promise.all(claims.map(c => (0, factcheck_1.verifyClaim)(c)));
        const report = (0, factcheck_1.generateReport)(verifications);
        res.json({ report, details: verifications });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'internal error' });
    }
});
const port = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(port, () => {
        console.log(`FactCheck API listening on port ${port}`);
    });
}
exports.default = app;
