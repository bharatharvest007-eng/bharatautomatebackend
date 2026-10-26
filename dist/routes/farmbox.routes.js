import { Router } from 'express';
import { FarmboxService } from '../services/farmboxService.js';
const router = Router();
// Produce catalog with Telugu + English descriptions
router.get('/catalog', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const items = query ? FarmboxService.searchProduce(query) : FarmboxService.getCatalog();
    return res.json({ ok: true, count: items.length, items });
});
// Curated boxes (Weekly Farm Box, Fruit Basket, Greens Detox)
router.get('/boxes', (_req, res) => {
    const boxes = FarmboxService.getBoxes();
    return res.json({ ok: true, boxes });
});
// "Cook the harvest" recipes
router.get('/recipes', (_req, res) => {
    const recipes = FarmboxService.getRecipes();
    return res.json({ ok: true, recipes });
});
// Delivery slots & coverage check
router.get('/slots', (req, res) => {
    const pincode = typeof req.query.pincode === 'string' ? req.query.pincode : undefined;
    const deliveryInfo = FarmboxService.getDeliverySlotsInfo(pincode);
    return res.json({ ok: true, delivery: deliveryInfo });
});
// Generate 1-click cart or box checkout link
router.post('/order-link', (req, res) => {
    const { boxId, items, ref } = req.body;
    const link = FarmboxService.generateCartLink(boxId || items || 'box_weekly_fresh', ref || 'social_dm');
    return res.json({ ok: true, link });
});
export default router;
