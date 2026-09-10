import express from "express";
import { createReview, updateReview, deleteReview, getMyReviewedProducts } from "../controllers/reviewController.js";
import { protect } from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = express.Router();

// Must be declared BEFORE /:id routes so Express doesn't treat "my-reviewed-products" as an id
router.get("/my-reviewed-products", protect, getMyReviewedProducts);

router.post("/", protect, upload.array("images", 4), createReview);
router.patch("/:id", protect, updateReview);
router.delete("/:id", protect, deleteReview);

export default router;
