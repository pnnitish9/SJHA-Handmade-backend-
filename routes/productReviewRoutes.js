import express from "express";
import { getProductReviews } from "../controllers/reviewController.js";

const router = express.Router();

router.get("/:productId/reviews", getProductReviews);

export default router;
