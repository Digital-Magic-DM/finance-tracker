import { Router, Request, Response } from 'express';
import { mfapiService } from '../services/mfapi.service';

const router = Router();

router.get('/nav/:isin', async (req: Request, res: Response) => {
  const isin = req.params.isin as string;
  try {
    const data = await mfapiService.getNavBySchemeCode(isin as string);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch NAV for ${isin}` });
  }
});

router.get('/metrics', (_req: Request, res: Response) => {
  res.json(mfapiService.getMetrics());
});

export default router;
