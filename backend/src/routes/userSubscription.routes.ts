import express from 'express';
import * as userSubscriptionController from '../controllers/userSubscription.controller';

const router = express.Router();

router.get('/', userSubscriptionController.list);
router.put('/:provider', userSubscriptionController.upsert);
router.delete('/:provider', userSubscriptionController.remove);

export default router;
