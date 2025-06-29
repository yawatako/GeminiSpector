import express from 'express';
import dotenv from 'dotenv';
import { extractClaims, verifyClaim, generateReport } from './factcheck';
import { Verification } from './types';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/factcheck', async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const claims = extractClaims(text);
    const verifications: Verification[] = await Promise.all(
      claims.map(c => verifyClaim(c))
    );
    const report = generateReport(verifications);
    res.json({ report, details: verifications });
  } catch (err) {
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

export default app;
